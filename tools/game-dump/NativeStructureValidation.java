package net.gtnhsolver.extractor;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileReader;
import java.io.FileWriter;
import java.lang.reflect.Field;
import java.net.JarURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import net.minecraft.block.Block;
import net.minecraft.init.Blocks;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Item;
import net.minecraft.item.ItemBlock;
import net.minecraft.network.PacketBuffer;
import net.minecraft.nbt.NBTTagCompound;
import net.minecraft.world.World;
import net.minecraft.world.WorldProvider;
import net.minecraftforge.common.util.ForgeDirection;
import net.minecraftforge.fluids.FluidStack;

import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.Gson;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.gtnewhorizon.structurelib.alignment.IAlignment;
import com.gtnewhorizon.structurelib.alignment.enumerable.ExtendedFacing;

import gregtech.api.GregTechAPI;
import gregtech.api.enums.Materials;
import gregtech.api.enums.ItemList;
import gregtech.api.interfaces.metatileentity.IMetaTileEntity;
import gregtech.api.interfaces.tileentity.IGregTechTileEntity;
import gregtech.api.metatileentity.BaseMetaTileEntity;
import gregtech.api.metatileentity.implementations.MTEHatch;
import gregtech.api.metatileentity.implementations.MTEHatchInput;
import gregtech.api.metatileentity.implementations.MTEHatchOutput;
import gregtech.api.metatileentity.implementations.MTEHatchDataAccess;
import gregtech.api.metatileentity.implementations.MTEMultiBlockBase;
import gregtech.api.recipe.check.CheckRecipeResult;
import gregtech.api.structure.error.StructureError;
import gregtech.api.util.GTUtility;
import gregtech.api.util.AssemblyLineUtils;
import gregtech.api.util.GTRecipe.RecipeAssemblyLine;
import gregtech.common.WirelessDataStore;
import net.minecraft.server.MinecraftServer;
import tectech.mechanics.dataTransport.ALRecipeDataPacket;
import tectech.thing.metaTileEntity.hatch.MTEHatchDataItemsInput;
import tectech.thing.metaTileEntity.hatch.MTEHatchDataItemsOutput;
import tectech.thing.metaTileEntity.hatch.MTEHatchWirelessDataItemsInput;
import tectech.thing.metaTileEntity.hatch.MTEHatchWirelessDataItemsOutput;
import io.netty.buffer.Unpooled;
import gtnhlanth.common.beamline.BeamInformation;
import gtnhlanth.common.beamline.BeamLinePacket;
import gtnhlanth.common.hatch.MTEHatchInputBeamline;
import gtnhlanth.common.hatch.MTEHatchOutputBeamline;

/** Runs the planner's exported blocks through real RC2 game checks, without a copied model validator. */
final class NativeStructureValidation {
    private static final int OX = 0, OY = 96, OZ = 0;
    private static final String[] TIERS = {
        "ULV", "LV", "MV", "HV", "EV", "IV", "LuV", "ZPM", "UV", "UHV", "UEV", "UIV", "UMV", "UXV", "MAX"
    };

    static void run(World world) throws Exception {
        JsonObject fixtures;
        try (FileReader reader = new FileReader(System.getProperty("gtnhextractor.nativeValidationIn"))) {
            fixtures = new JsonParser().parse(reader).getAsJsonObject();
        }
        if (fixtures.get("schema").getAsInt() != 1 || !"2.9.0-RC-2".equals(fixtures.get("pack").getAsString())
            || !"a3e1e11241a814c9fa0dd0973d5699548428f689".equals(fixtures.get("sourceCommit").getAsString()))
            throw new IllegalArgumentException("Expected native fixture schema 1 and pinned RC2 pack");
        Map<String, Object> report = new LinkedHashMap<>();
        report.put("pack", fixtures.get("pack").getAsString());
        report.put("sourceCommit", fixtures.get("sourceCommit").getAsString());
        if (fixtures.has("catalogProbe")) report.put("catalogProbe", fixtures.get("catalogProbe"));
        List<Map<String, String>> jars = new ArrayList<>();
        // This verifies the code actually loaded by Forge, rather than a user-supplied mod-version label.
        for (Class<?> cls : new Class<?>[] { MTEMultiBlockBase.class, IAlignment.class }) {
            URL location = cls.getProtectionDomain().getCodeSource().getLocation();
            if ("jar".equals(location.getProtocol())) location = ((JarURLConnection) location.openConnection()).getJarFileURL();
            File file = new File(location.toURI());
            String digest = sha256(file);
            boolean pinned = false;
            for (JsonElement item : fixtures.getAsJsonArray("jars"))
                if (digest.equals(item.getAsJsonObject().get("sha256").getAsString())) pinned = true;
            if (!pinned) throw new IllegalStateException("Loaded unpinned game jar " + file + " SHA256 " + digest);
            Map<String, String> jar = new LinkedHashMap<>();
            jar.put("class", cls.getName()); jar.put("path", file.getAbsolutePath()); jar.put("sha256", digest);
            jars.add(jar);
        }
        report.put("loadedJars", jars);
        List<Map<String, Object>> results = new ArrayList<>();
        int failed = 0;
        for (JsonElement item : fixtures.getAsJsonArray("cases")) {
            JsonObject test = item.getAsJsonObject();
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("name", test.get("name").getAsString());
            result.put("machine", test.get("machine").getAsString());
            result.put("source", test.get("source").getAsString());
            JsonObject snapshot = new JsonObject();
            snapshot.add("circuit", test.get("circuit"));
            if (test.has("controllerFacing")) snapshot.add("controllerFacing", test.get("controllerFacing"));
            snapshot.add("cells", test.get("cells"));
            if (test.has("crackingPair")) snapshot.add("crackingPair", test.get("crackingPair"));
            if (test.has("expectedHatchFields")) snapshot.add("expectedHatchFields", test.get("expectedHatchFields"));
            if (test.has("expectedBlockFacings")) snapshot.add("expectedBlockFacings", test.get("expectedBlockFacings"));
            if (test.has("expectedBeamRates")) snapshot.add("expectedBeamRates", test.get("expectedBeamRates"));
            if (test.has("expectedFluidDrain")) snapshot.add("expectedFluidDrain", test.get("expectedFluidDrain"));
            if (test.has("expectedControllerFields")) snapshot.add("expectedControllerFields", test.get("expectedControllerFields"));
            if (test.has("dataBankWireless")) snapshot.add("dataBankWireless", test.get("dataBankWireless"));
            if (test.has("checkRecipeData")) snapshot.add("checkRecipeData", test.get("checkRecipeData"));
            if (test.has("processingEnvironment")) snapshot.add("processingEnvironment", test.get("processingEnvironment"));
            if (test.has("expectedFluidProcessing")) snapshot.add("expectedFluidProcessing", test.get("expectedFluidProcessing"));
            if (test.has("expectedHatchCounts")) snapshot.add("expectedHatchCounts", test.get("expectedHatchCounts"));
            if (test.has("expectedElectrode")) snapshot.add("expectedElectrode", test.get("expectedElectrode"));
            result.put("placementSha256", sha256(snapshot.toString().getBytes(StandardCharsets.UTF_8)));
            boolean passed = false;
            try {
                passed = runCase(world, test, result);
            } catch (Throwable error) {
                result.put("exception", error.toString());
                error.printStackTrace();
            } finally {
                clear(world, test.getAsJsonArray("cells"));
            }
            result.put("passed", passed);
            if (!passed) failed++;
            results.add(result);
            System.out.println("NATIVE_RC2 " + (passed ? "PASS " : "FAIL ") + test.get("name").getAsString());
        }
        report.put("results", results);
        report.put("passed", results.size() - failed);
        report.put("failed", failed);
        File out = new File(System.getProperty("gtnhextractor.nativeValidationOut"));
        if (out.getParentFile() != null) Files.createDirectories(out.getParentFile().toPath());
        try (FileWriter writer = new FileWriter(out)) {
            new GsonBuilder().setPrettyPrinting().create().toJson(report, writer);
        }
        if (failed > 0) throw new IllegalStateException(failed + " native RC2 cases failed; see " + out);
    }

    private static boolean runCase(World world, JsonObject test, Map<String, Object> result) throws Exception {
        JsonArray cells = test.getAsJsonArray("cells");
        clear(world, cells);
        MTEMultiBlockBase controller = null;
        List<MTEMultiBlockBase> crackingControllers = new ArrayList<>();
        IMetaTileEntity legacyBrickedController = null;
        Map<String, List<MTEHatchInput>> fluidInputs = new LinkedHashMap<>();
        Map<MTEHatchOutput, Integer> expectedSlots = new LinkedHashMap<>();
        Map<IMetaTileEntity, String> hatchResources = new LinkedHashMap<>();
        Map<String, MTEHatch> filledHatches = new LinkedHashMap<>();
        Map<String, Integer> filledAmounts = new LinkedHashMap<>();
        List<Map<String, Object>> hatchData = new ArrayList<>();
        for (JsonElement item : cells) {
            JsonObject cell = item.getAsJsonObject();
            int[] p = position(cell);
            if (cell.has("hatch")) {
                String kind = cell.get("hatch").getAsString();
                int tier = cell.has("tier") ? tier(cell.get("tier").getAsString()) : -1;
                int meta = hatchMeta(kind, tier);
                BaseMetaTileEntity base = placeMachine(world, p, meta, ForgeDirection.valueOf(cell.get("face").getAsString().toUpperCase()));
                IMetaTileEntity hatch = base.getMetaTileEntity();
                if (cell.has("resource")) hatchResources.put(hatch, cell.get("resource").getAsString());
                Map<String, Object> data = new LinkedHashMap<>();
                data.put("kind", kind); data.put("tier", tier); data.put("meta", meta); data.put("class", hatch.getClass().getName());
                data.put("pos", cell.getAsJsonArray("pos"));
                hatchData.add(data);
                if (cell.has("fluid")) {
                    MTEHatchInput input = (MTEHatchInput) hatch;
                    input.setFillableStack(fluid(cell.get("fluid").getAsString()));
                    String resource = cell.get("resource").getAsString();
                    fluidInputs.computeIfAbsent(resource, key -> new ArrayList<>()).add(input);
                }
                if (cell.has("outputSlot")) expectedSlots.put((MTEHatchOutput) hatch, cell.get("outputSlot").getAsInt());
                if (cell.has("fillFluid")) {
                    FluidStack stack = fluid(cell.get("fillFluid").getAsString());
                    stack.amount = cell.get("fillAmount").getAsInt();
                    String resource = cell.get("resource").getAsString();
                    MTEHatch tank = (MTEHatch) hatch;
                    filledAmounts.put(resource, tank.fill(stack, true));
                    filledHatches.put(resource, tank);
                }
            } else {
                String[] blockParts = cell.get("block").getAsString().split("@");
                String registry = blockParts[0];
                int meta = Integer.parseInt(blockParts[1]);
                if ("gregtech:gt.blockmachines".equals(registry)) {
                    ForgeDirection facing = cell.has("face")
                        ? ForgeDirection.valueOf(cell.get("face").getAsString().toUpperCase())
                        : test.has("controllerFacing")
                            ? ForgeDirection.valueOf(test.get("controllerFacing").getAsString().toUpperCase()) : ForgeDirection.NORTH;
                    BaseMetaTileEntity base = placeMachine(world, p, meta, facing);
                    if (cell.has("resource")) hatchResources.put(base.getMetaTileEntity(), cell.get("resource").getAsString());
                    if (cell.has("beam")) {
                        JsonObject packet = cell.getAsJsonObject("beam");
                        ((MTEHatchInputBeamline) base.getMetaTileEntity()).dataPacket = new BeamLinePacket(
                            new BeamInformation(packet.get("energy").getAsFloat(), packet.get("rate").getAsInt(),
                                packet.get("particle").getAsInt(), packet.get("focus").getAsFloat()));
                    }
                    if (base.getMetaTileEntity() instanceof MTEMultiBlockBase) {
                        if (test.has("crackingPair")) {
                            if (!base.getMetaTileEntity().getClass().getName().equals("gregtech.common.tileentities.machines.multi.MTEOilCracker"))
                                throw new IllegalArgumentException("The pair exception only supports Oil Cracking Unit");
                            crackingControllers.add((MTEMultiBlockBase) base.getMetaTileEntity());
                        } else {
                            if (controller != null || legacyBrickedController != null) throw new IllegalArgumentException("Several controllers in one native case");
                            controller = (MTEMultiBlockBase) base.getMetaTileEntity();
                        }
                    } else if (base.getMetaTileEntity().getClass().getName().equals("gregtech.common.tileentities.machines.multi.MTEBrickedBlastFurnace")) {
                        if (controller != null || legacyBrickedController != null) throw new IllegalArgumentException("Several controllers in one native case");
                        legacyBrickedController = base.getMetaTileEntity();
                    }
                } else {
                    Block block = Block.getBlockFromName(registry);
                    if (block == null) throw new IllegalArgumentException("Unregistered native block " + registry);
                    // BartWorks material casings encode their large material ID in the tile entity too.
                    // Raw setBlock leaves that ID at zero; use the item's real placement hook.
                    Item itemBlock = Item.getItemFromBlock(block);
                    if (itemBlock != null && "BWItemMetaGeneratedBlock".equals(itemBlock.getClass().getSimpleName())) {
                        if (!((ItemBlock) itemBlock).placeBlockAt(new ItemStack(itemBlock, 1, meta), null, world,
                            p[0], p[1], p[2], 1, 0, 0, 0, meta)) throw new IllegalStateException("Material block placement failed: " + cell);
                    } else world.setBlock(p[0], p[1], p[2], block, meta, 3);
                    if (world.getBlock(p[0], p[1], p[2]) != block || world.getBlockMetadata(p[0], p[1], p[2]) != meta)
                        throw new IllegalStateException("Block placement failed: " + cell);
                }
            }
        }
        for (JsonElement entry : cells) {
            JsonObject cell = entry.getAsJsonObject();
            if (!cell.has("fillItem")) continue;
            String[] parts = cell.get("fillItem").getAsString().split("@");
            Item item = (Item) Item.itemRegistry.getObject(parts[0]);
            if (item == null) throw new IllegalArgumentException("Unknown item " + parts[0]);
            ItemStack stack = new ItemStack(item, 1, Integer.parseInt(parts[1]));
            if (cell.has("usedDurability")) {
                stack.stackTagCompound = new NBTTagCompound();
                stack.stackTagCompound.setInteger("durability", cell.get("usedDurability").getAsInt());
            }
            int[] pos = position(cell);
            ((BaseMetaTileEntity) world.getTileEntity(pos[0], pos[1], pos[2])).setInventorySlotContents(0, stack);
        }
        if (legacyBrickedController != null) {
            // RC2's BBF predates MTEMultiBlockBase and has a private boolean checkMachine().
            // Call that actual checker, rather than duplicating its shape or treating it as formed.
            java.lang.reflect.Method check = legacyBrickedController.getClass().getDeclaredMethod("checkMachine");
            check.setAccessible(true);
            boolean formed = (Boolean) check.invoke(legacyBrickedController);
            result.put("controllerClass", legacyBrickedController.getClass().getName());
            result.put("structureCheck", "private-checkMachine");
            result.put("formed", formed);
            result.put("hatches", hatchData);
            result.put("errors", new ArrayList<>());
            return formed == test.get("expectedStructure").getAsBoolean();
        }
        if (test.has("crackingPair")) {
            if (crackingControllers.size() != 2) throw new IllegalArgumentException("Expected exactly two crackers");
            JsonObject pair = test.getAsJsonObject("crackingPair");
            int[] sharedPos = position(pair);
            IMetaTileEntity shared = ((BaseMetaTileEntity) world.getTileEntity(sharedPos[0], sharedPos[1], sharedPos[2])).getMetaTileEntity();
            List<Map<String, Object>> checked = new ArrayList<>();
            boolean passed = true;
            for (MTEMultiBlockBase cracker : crackingControllers) {
                BaseMetaTileEntity tile = (BaseMetaTileEntity) cracker.getBaseMetaTileEntity();
                List<StructureError> errors = new ArrayList<>();
                cracker.checkMachine(tile, GTUtility.getIntegratedCircuit(0), errors);
                boolean sharedInput = ((List<?>) findField(cracker.getClass(), "mInputHatches").get(cracker)).contains(shared);
                int casings = findField(cracker.getClass(), "mCasingAmount").getInt(cracker);
                Map<String, Object> observed = new LinkedHashMap<>();
                observed.put("formed", errors.isEmpty()); observed.put("casings", casings);
                observed.put("sharedInput", sharedInput);
                List<String> ids = new ArrayList<>();
                for (StructureError error : errors) ids.add(error.getId().name());
                observed.put("errors", ids); checked.add(observed);
                passed &= errors.isEmpty() && casings >= 18 && sharedInput;
            }
            result.put("controllers", checked); result.put("hatches", hatchData);
            result.put("formed", passed); return passed;
        }
        if (controller == null) throw new IllegalStateException("No controller");
        ItemStack circuit = GTUtility.getIntegratedCircuit(test.get("circuit").getAsInt());
        BaseMetaTileEntity base = (BaseMetaTileEntity) controller.getBaseMetaTileEntity();
        base.setInventorySlotContents(1, circuit);
        base.enableWorking();
        List<StructureError> errors = new ArrayList<>();
        controller.checkMachine(base, circuit, errors);
        boolean formed = errors.isEmpty();
        result.put("controllerClass", controller.getClass().getName());
        result.put("hatches", hatchData);
        result.put("formed", formed);
        List<Map<String, String>> diagnostics = new ArrayList<>();
        for (StructureError error : errors) {
            Map<String, String> data = new LinkedHashMap<>();
            data.put("id", error.getId().name());
            // Display strings are client-only. Preserve native diagnostic fields through its network codec instead.
            PacketBuffer buffer = new PacketBuffer(Unpooled.buffer());
            try {
                error.serialize(buffer);
                byte[] bytes = new byte[buffer.readableBytes()];
                buffer.readBytes(bytes);
                data.put("payload", java.util.Base64.getEncoder().encodeToString(bytes));
            } finally { buffer.release(); }
            diagnostics.add(data);
        }
        result.put("errors", diagnostics);
        boolean passed = formed == test.get("expectedStructure").getAsBoolean();
        if (test.has("dataBankWireless"))
            findField(controller.getClass(), "wirelessModeEnabled").setBoolean(controller, test.get("dataBankWireless").getAsBoolean());
        if (test.has("checkRecipeData")) {
            JsonObject observed = checkRecipeData(world, test, controller, hatchResources);
            result.put("recipeData", observed);
            passed &= test.getAsJsonObject("checkRecipeData").get("expected").equals(observed);
        }
        if (test.has("expectedProcessing")) {
            WorldProvider originalProvider = world.provider;
            if (test.has("processingEnvironment")) {
                JsonObject environment = test.getAsJsonObject("processingEnvironment");
                findField(controller.getClass(), "currentHumidity").setFloat(controller, environment.get("humidity").getAsFloat());
                final String dimension = environment.get("dimension").getAsString();
                findField(world.getClass(), "provider").set(world, new WorldProvider() {
                    @Override public String getDimensionName() { return dimension; }
                });
            }
            CheckRecipeResult processing;
            try { processing = controller.checkProcessing(); }
            finally { findField(world.getClass(), "provider").set(world, originalProvider); }
            result.put("processingSucceeded", processing.wasSuccessful());
            result.put("processingResult", processing.getID());
            passed &= processing.wasSuccessful() == test.get("expectedProcessing").getAsBoolean();
            if (test.has("expectedFluidProcessing")) {
                JsonObject observed = new JsonObject();
                observed.addProperty("result", processing.writeToNBT(new NBTTagCompound()).getString("key"));
                observed.addProperty("duration", findField(controller.getClass(), "mMaxProgresstime").getInt(controller));
                observed.add("filled", new Gson().toJsonTree(filledAmounts));
                Map<String, Integer> remaining = new LinkedHashMap<>();
                for (Map.Entry<String, MTEHatch> entry : filledHatches.entrySet()) remaining.put(entry.getKey(), entry.getValue().getFluidAmount());
                observed.add("remaining", new Gson().toJsonTree(remaining));
                JsonArray outputs = new JsonArray();
                FluidStack[] produced = (FluidStack[]) findField(controller.getClass(), "mOutputFluids").get(controller);
                if (produced != null) for (FluidStack fluid : produced) {
                    JsonObject output = new JsonObject();
                    output.addProperty("fluid", fluid.getFluid().getName()); output.addProperty("amount", fluid.amount);
                    outputs.add(output);
                }
                observed.add("outputs", outputs);
                result.put("fluidProcessing", observed);
                passed &= observed.equals(test.getAsJsonObject("expectedFluidProcessing"));
            }
        }
        if (test.has("expectedBlockFacings")) {
            Map<String, String> actual = new LinkedHashMap<>();
            for (Map.Entry<String, JsonElement> entry : test.getAsJsonObject("expectedBlockFacings").entrySet()) {
                String[] parts = entry.getKey().split(",");
                IGregTechTileEntity tile = (IGregTechTileEntity) world.getTileEntity(
                    OX + Integer.parseInt(parts[0]), OY + Integer.parseInt(parts[1]), OZ + Integer.parseInt(parts[2]));
                String face = tile.getFrontFacing().name().toLowerCase();
                actual.put(entry.getKey(), face);
                passed &= entry.getValue().getAsString().equals(face);
            }
            result.put("blockFacings", actual);
        }
        if (test.has("expectedBeamRates")) {
            List<Integer> rates = new ArrayList<>();
            for (JsonElement element : test.getAsJsonArray("cells")) {
                JsonObject cell = element.getAsJsonObject();
                if (!cell.has("block") || !(cell.get("block").getAsString().equals("gregtech:gt.blockmachines@10504")
                    || cell.get("block").getAsString().equals("gregtech:gt.blockmachines@3014"))) continue;
                int[] pos = position(cell);
                MTEHatchOutputBeamline output = (MTEHatchOutputBeamline) ((IGregTechTileEntity)
                    world.getTileEntity(pos[0], pos[1], pos[2])).getMetaTileEntity();
                rates.add(output.dataPacket == null ? -1 : output.dataPacket.getContent().getRate());
            }
            result.put("beamRates", rates);
            JsonArray expected = test.getAsJsonArray("expectedBeamRates");
            passed &= rates.size() == expected.size();
            for (int i = 0; i < Math.min(rates.size(), expected.size()); i++) passed &= rates.get(i) == expected.get(i).getAsInt();
        }
        if (test.has("expectedFluids")) {
            @SuppressWarnings("unchecked")
            List<FluidStack> seen = (List<FluidStack>) controller.getClass()
                .getMethod("getStoredFluidsForColor", Optional.class).invoke(controller, Optional.empty());
            List<String> actual = new ArrayList<>();
            for (Map.Entry<String, List<MTEHatchInput>> entry : fluidInputs.entrySet())
                for (MTEHatchInput hatch : entry.getValue())
                    if (seen.stream().anyMatch(f -> f == hatch.getFillableStack())) actual.add(entry.getKey());
            List<String> expected = new ArrayList<>();
            for (JsonElement e : test.getAsJsonArray("expectedFluids")) expected.add(e.getAsString());
            Collections.sort(actual); Collections.sort(expected);
            result.put("seenFluidResources", actual);
            passed &= actual.equals(expected);
        }
        if (test.has("checkOutputSlots") && test.get("checkOutputSlots").getAsBoolean()) {
            Field field = findField(controller.getClass(), test.has("outputSlotField")
                ? test.get("outputSlotField").getAsString() : "outputHatchesPerLayer");
            @SuppressWarnings("unchecked")
            List<List<MTEHatchOutput>> slots = (List<List<MTEHatchOutput>>) field.get(controller);
            List<Map<String, Integer>> actual = new ArrayList<>();
            for (Map.Entry<MTEHatchOutput, Integer> entry : expectedSlots.entrySet()) {
                int nativeSlot = -1;
                for (int i = 0; i < slots.size(); i++) if (slots.get(i).contains(entry.getKey())) nativeSlot = i;
                Map<String, Integer> mapping = new LinkedHashMap<>();
                mapping.put("expected", entry.getValue()); mapping.put("actual", nativeSlot);
                actual.add(mapping);
                passed &= entry.getValue() == nativeSlot;
            }
            if (expectedSlots.isEmpty()) throw new IllegalStateException("No expected output slots");
            result.put("outputSlots", actual);
        }
        if (test.has("expectedControllerFields")) {
            JsonObject observed = new JsonObject();
            Gson gson = new Gson();
            for (Map.Entry<String, JsonElement> entry : test.getAsJsonObject("expectedControllerFields").entrySet()) {
                Object actual = findField(controller.getClass(), entry.getKey()).get(controller);
                JsonElement value = gson.toJsonTree(actual);
                observed.add(entry.getKey(), value);
                passed &= entry.getValue().equals(value);
            }
            result.put("controllerFields", observed);
        }
        if (test.has("expectedHatchFields")) {
            boolean matches = true;
            List<Map<String, String>> mappings = new ArrayList<>();
            for (Map.Entry<String, JsonElement> entry : test.getAsJsonObject("expectedHatchFields").entrySet()) {
                Object hatch = findField(controller.getClass(), entry.getKey()).get(controller);
                if (hatch instanceof java.util.Collection) {
                    java.util.Collection<?> hatches = (java.util.Collection<?>) hatch;
                    hatch = hatches.size() == 1 ? hatches.iterator().next() : null;
                }
                String actual = hatchResources.get(hatch);
                if (actual == null) actual = "";
                String expected = entry.getValue().getAsString();
                Map<String, String> mapping = new LinkedHashMap<>();
                mapping.put("field", entry.getKey()); mapping.put("expected", expected); mapping.put("actual", actual);
                mappings.add(mapping);
                matches &= expected.equals(actual);
            }
            result.put("hatchFields", mappings);
            passed &= matches == (!test.has("expectedHatchFieldsMatch") || test.get("expectedHatchFieldsMatch").getAsBoolean());
        }
        if (test.has("expectedElectrode")) {
            IMetaTileEntity hatch = (IMetaTileEntity) findField(controller.getClass(), "electrodeHatch").get(controller);
            ItemStack stack = hatch.getStackInSlot(0);
            kubatech.loaders.ArcFurnaceElectrode variant = kubatech.loaders.ArcFurnaceElectrode.getByStack(stack);
            kubatech.loaders.ArcFurnaceElectrode operating = (kubatech.loaders.ArcFurnaceElectrode) findField(controller.getClass(), "electrode").get(controller);
            JsonObject observed = new JsonObject();
            observed.addProperty("gameId", Item.itemRegistry.getNameForObject(stack.getItem()) + "@" + stack.getItemDamage());
            observed.addProperty("slotAccepts", hatch.isItemValidForSlot(0, stack));
            observed.addProperty("recognizedMeta", variant == null ? -1 : variant.id);
            observed.addProperty("operatingMeta", operating == null ? -1 : operating.id);
            observed.addProperty("remainingDurability", kubatech.loaders.ArcFurnaceLoader.ARC_FURNACE_ELECTRODE.remainingDurability(stack));
            observed.addProperty("maxStack", stack.getMaxStackSize());
            observed.addProperty("inventorySize", hatch.getSizeInventory());
            if (test.getAsJsonObject("expectedElectrode").has("detectorRemaining")) {
                java.util.Collection<?> detectors = (java.util.Collection<?>) findField(controller.getClass(), "electrodeDetectorHatch").get(controller);
                Object detector = detectors.iterator().next();
                observed.addProperty("detectorRemaining", ((Number) findField(detector.getClass(), "lastDurability").get(detector)).intValue());
                observed.addProperty("detectorMaximum", ((Number) findField(detector.getClass(), "lastMaxDurability").get(detector)).intValue());
            }
            result.put("electrode", observed);
            passed &= observed.equals(test.getAsJsonObject("expectedElectrode"));
        }
        if (test.has("expectedHatchCounts")) {
            JsonObject observed = new JsonObject();
            for (Map.Entry<String, JsonElement> entry : test.getAsJsonObject("expectedHatchCounts").entrySet()) {
                Object hatches = findField(controller.getClass(), entry.getKey()).get(controller);
                int count = hatches instanceof java.util.Collection ? ((java.util.Collection<?>) hatches).size() : hatches == null ? 0 : 1;
                observed.addProperty(entry.getKey(), count);
                passed &= entry.getValue().getAsInt() == count;
            }
            result.put("hatchCounts", observed);
        }
        if (test.has("expectedFluidDrain")) {
            JsonObject expected = test.getAsJsonObject("expectedFluidDrain");
            String methodName = expected.get("method").getAsString();
            int amount = expected.get("amount").getAsInt();
            java.lang.reflect.Method drain = controller.getClass().getDeclaredMethod(methodName, int.class);
            drain.setAccessible(true);
            boolean success = (Boolean) drain.invoke(controller, amount);
            Map<String, Object> observed = new LinkedHashMap<>();
            observed.put("method", methodName); observed.put("amount", amount); observed.put("success", success);
            observed.put("filled", filledAmounts);
            Map<String, Integer> remaining = new LinkedHashMap<>();
            for (Map.Entry<String, MTEHatch> entry : filledHatches.entrySet()) remaining.put(entry.getKey(), entry.getValue().getFluidAmount());
            observed.put("remaining", remaining);
            result.put("fluidDrain", observed);
            passed &= new GsonBuilder().create().toJsonTree(observed).equals(expected);
        }
        return passed;
    }

    private static BaseMetaTileEntity placeMachine(World world, int[] p, int id, ForgeDirection facing) throws Exception {
        IMetaTileEntity prototype = GregTechAPI.METATILEENTITIES[id];
        if (prototype == null) throw new IllegalStateException("Unregistered MetaTileEntity " + id);
        Block block = Block.getBlockFromItem(prototype.getStackForm(1).getItem());
        if (block == null || block == Blocks.air) throw new IllegalStateException("No block for MetaTileEntity " + id);
        world.setBlock(p[0], p[1], p[2], block, 0, 3);
        BaseMetaTileEntity base = (BaseMetaTileEntity) world.getTileEntity(p[0], p[1], p[2]);
        base.setMetaTileID((short) id);
        base.setOwnerUuid(UUID.fromString("00000000-0000-0000-0000-0000000e17ac"));
        base.setOwnerName("gtnhextractor");
        IMetaTileEntity instance = prototype.newMetaEntity(base);
        base.setMetaTileEntity(instance);
        instance.setBaseMetaTileEntity(base);
        base.setFrontFacing(facing);
        if (instance instanceof MTEMultiBlockBase && instance instanceof IAlignment) {
            Field field = findField(instance.getClass(), "mExtendedFacing");
            field.set(instance, ExtendedFacing.of(facing));
        }
        return base;
    }

    private static int hatchMeta(String kind, int tier) {
        String name;
        switch (kind) {
            case "computationIn": return 15440;
            case "computationOut": return 15441;
            case "wirelessComputationIn": return 15445;
            case "wirelessComputationOut": return 15444;
            case "computerRack": return 15450;
            case "uncertainty":
                if (tier == 5) return 15430;
                if (tier == 7) return 15431;
                throw new IllegalArgumentException("No registered Uncertainty Resolver tier " + tier);
            case "electrodeIn": return 14203;
            case "electrodeBus": return 14203;
            case "electrodeDetector": return 14204;
            case "steamIn": return 31040;
            case "cryotheumIn": return 967;
            case "pyrotheumIn": return 968;
            case "itemIn": name = "MTEHatchInputBus"; break;
            case "itemOut": name = "MTEHatchOutputBus"; break;
            case "fluidIn": name = "MTEHatchInput"; break;
            case "fluidOut": name = "MTEHatchOutput"; break;
            case "energy": name = "MTEHatchEnergy"; break;
            case "dynamo": name = "MTEHatchDynamo"; break;
            case "maintenance": name = "MTEHatchMaintenance"; break;
            case "dataAccess": name = "MTEHatchDataAccess"; break;
            case "assemblyDataIn": return 15442;
            case "assemblyDataOut": return 15443;
            case "wirelessAssemblyDataIn": return 15446;
            case "wirelessAssemblyDataOut": return 15447;
            case "muffler": name = "MTEHatchMuffler"; break;
            default: throw new IllegalArgumentException("Unsupported native hatch " + kind);
        }
        String cls = "gregtech.api.metatileentity.implementations." + name;
        for (int i = 0; i < GregTechAPI.METATILEENTITIES.length; i++) {
            IMetaTileEntity prototype = GregTechAPI.METATILEENTITIES[i];
            if (prototype != null && prototype.getClass().getName().equals(cls)
                && ("maintenance".equals(kind) || ((MTEHatch) prototype).mTier == tier)) return i;
        }
        throw new IllegalArgumentException("No exact standard " + kind + " hatch of tier " + tier);
    }

    private static int tier(String name) {
        for (int i = 0; i < TIERS.length; i++) if (TIERS[i].equals(name)) return i;
        throw new IllegalArgumentException("Unknown tier " + name);
    }

    private static FluidStack fluid(String name) {
        FluidStack stack;
        switch (name) {
            case "light-fuel": stack = Materials.LightFuel.getFluid(1000); break;
            case "steam": stack = Materials.Steam.getGas(1000); break;
            case "water": stack = Materials.Water.getFluid(1000); break;
            case "hydrogen": stack = Materials.Hydrogen.getGas(1000); break;
            case "cryotheum": stack = new FluidStack(gtPlusPlus.xmod.thermalfoundation.fluid.TFFluids.fluidCryotheum, 1000); break;
            case "pyrotheum": stack = new FluidStack(gtPlusPlus.xmod.thermalfoundation.fluid.TFFluids.fluidPyrotheum, 1000); break;
            default: throw new IllegalArgumentException("Unknown native test fluid " + name);
        }
        if (stack == null) throw new IllegalStateException("Test fluid is unregistered: " + name);
        return stack;
    }

    private static int[] position(JsonObject cell) {
        JsonArray p = cell.getAsJsonArray("pos");
        return new int[] { OX + p.get(0).getAsInt(), OY + p.get(1).getAsInt(), OZ + p.get(2).getAsInt() };
    }

    private static void clear(World world, JsonArray cells) {
        for (JsonElement item : cells) {
            int[] p = position(item.getAsJsonObject());
            world.setBlockToAir(p[0], p[1], p[2]);
        }
    }

    /** Actual registered data-stick lookup, packet creation and receiver methods; no synthetic recipes. */
    private static JsonObject checkRecipeData(World world, JsonObject test, MTEMultiBlockBase controller,
        Map<IMetaTileEntity, String> resources) throws Exception {
        JsonObject spec = test.getAsJsonObject("checkRecipeData");
        boolean loaded = spec.get("loaded").getAsBoolean();
        RecipeAssemblyLine recipe = null;
        for (RecipeAssemblyLine candidate : RecipeAssemblyLine.sAssemblylineRecipes)
            if (AssemblyLineUtils.findALRecipeByOutput(candidate.mOutput).size() == 1) { recipe = candidate; break; }
        if (recipe == null) throw new IllegalStateException("No unique registered assembly recipe for the data-stick test");
        List<RecipeAssemblyLine> recipes = loaded ? Collections.singletonList(recipe) : Collections.emptyList();
        MTEHatchDataAccess input = null;
        MTEHatchDataItemsOutput wired = null;
        MTEHatchWirelessDataItemsOutput wireless = null;
        UUID outputOwner = UUID.nameUUIDFromBytes((test.get("name").getAsString() + ":out").getBytes(StandardCharsets.UTF_8));
        UUID inputOwner = UUID.nameUUIDFromBytes((test.get("name").getAsString() + ":in").getBytes(StandardCharsets.UTF_8));
        for (IMetaTileEntity hatch : resources.keySet()) {
            if (hatch instanceof MTEHatchDataAccess) input = (MTEHatchDataAccess) hatch;
            if (hatch instanceof MTEHatchDataItemsOutput) wired = (MTEHatchDataItemsOutput) hatch;
            if (hatch instanceof MTEHatchWirelessDataItemsOutput) wireless = (MTEHatchWirelessDataItemsOutput) hatch;
            hatch.getBaseMetaTileEntity().setOwnerUuid(outputOwner);
        }
        if (input == null || wired == null || wireless == null) throw new IllegalStateException("Missing packet-test interfaces");
        MinecraftServer server = MinecraftServer.getServer();
        Field clock = findField(server.getClass(), "tickCounter");
        int originalTick = clock.getInt(server);
        int[] wiredReceiverPos = null;
        int[] wirelessReceiverPos = {OX+16,OY+8,OZ+16};
        try {
            if (input instanceof MTEHatchWirelessDataItemsInput) {
                input.getBaseMetaTileEntity().setOwnerUuid(inputOwner);
                WirelessDataStore.getWirelessDataSticks(inputOwner).uploadData(recipes, 200);
                clock.setInt(server, 201);
                input.onPreTick(input.getBaseMetaTileEntity(), 201);
            } else if (input instanceof MTEHatchDataItemsInput) {
                ((MTEHatchDataItemsInput) input).setContents(loaded ? new ALRecipeDataPacket(new RecipeAssemblyLine[]{recipe}) : null);
            } else if (loaded) {
                ItemStack stick = ItemList.Tool_DataStick.get(1L);
                if (!AssemblyLineUtils.setAssemblyLineRecipeOnDataStick(stick, recipe))
                    throw new IllegalStateException("Actual data stick rejected the registered recipe");
                input.setInventorySlotContents(0, stick);
            }
            // Empty data must clear old packets; a fresh loaded case starts with empty outputs.
            if (!loaded) {
                wired.q = new ALRecipeDataPacket(new RecipeAssemblyLine[]{recipe});
                wireless.dataPacket = new ALRecipeDataPacket(new RecipeAssemblyLine[]{recipe});
            }
            controller.getClass().getMethod("outputAfterRecipe_EM").invoke(controller);
            JsonObject observed = new JsonObject();
            observed.addProperty("readRecipes", input.getAssemblyLineRecipes().size());
            observed.addProperty("wiredPackets", wired.q == null ? 0 : wired.q.getContent().length);
            observed.addProperty("wirelessPackets", wireless.dataPacket == null ? 0 : wireless.dataPacket.getContent().length);
            boolean same = (!loaded || input.getAssemblyLineRecipes().get(0) == recipe)
                && (wired.q == null || wired.q.getContent()[0] == recipe)
                && (wireless.dataPacket == null || wireless.dataPacket.getContent()[0] == recipe);
            observed.addProperty("sameRecipes", same);
            IGregTechTileEntity outBase = wired.getBaseMetaTileEntity();
            ForgeDirection face = outBase.getFrontFacing();
            wiredReceiverPos = new int[]{outBase.getXCoord()+face.offsetX,outBase.getYCoord()+face.offsetY,outBase.getZCoord()+face.offsetZ};
            BaseMetaTileEntity receiverBase = placeMachine(world, wiredReceiverPos, 15442,
                spec.has("wrongFace") && spec.get("wrongFace").getAsBoolean() ? face : face.getOpposite());
            outBase.setColorization((byte)0);
            receiverBase.setColorization((byte)(spec.has("wrongColor") && spec.get("wrongColor").getAsBoolean() ? 1 : 0));
            wired.moveAround(outBase);
            MTEHatchDataItemsInput receiver = (MTEHatchDataItemsInput)receiverBase.getMetaTileEntity();
            observed.addProperty("wiredReceived", receiver.getAssemblyLineRecipes().size());
            observed.addProperty("wiredReceiverMatches", receiver.getAssemblyLineRecipes().isEmpty() || receiver.getAssemblyLineRecipes().get(0) == recipe);
            clock.setInt(server, 400);
            wireless.onPostTick(wireless.getBaseMetaTileEntity(),400);
            observed.addProperty("wirelessUploaded", WirelessDataStore.getWirelessDataSticks(outputOwner).downloadData(400).size());
            BaseMetaTileEntity wirelessReceiverBase = placeMachine(world,wirelessReceiverPos,15446,ForgeDirection.NORTH);
            wirelessReceiverBase.setOwnerUuid(spec.has("wrongOwner") && spec.get("wrongOwner").getAsBoolean()
                ? UUID.nameUUIDFromBytes((test.get("name").getAsString()+":wrong").getBytes(StandardCharsets.UTF_8)) : outputOwner);
            clock.setInt(server, 401);
            MTEHatchWirelessDataItemsInput wirelessReceiver = (MTEHatchWirelessDataItemsInput)wirelessReceiverBase.getMetaTileEntity();
            wirelessReceiver.onPreTick(wirelessReceiverBase,401);
            observed.addProperty("wirelessReceived", wirelessReceiver.getAssemblyLineRecipes().size());
            observed.addProperty("wirelessReceiverMatches", wirelessReceiver.getAssemblyLineRecipes().isEmpty() || wirelessReceiver.getAssemblyLineRecipes().get(0) == recipe);
            return observed;
        } finally {
            clock.setInt(server, originalTick);
            if (wiredReceiverPos != null) world.setBlockToAir(wiredReceiverPos[0],wiredReceiverPos[1],wiredReceiverPos[2]);
            world.setBlockToAir(wirelessReceiverPos[0],wirelessReceiverPos[1],wirelessReceiverPos[2]);
        }
    }

    private static Field findField(Class<?> cls, String name) throws NoSuchFieldException {
        for (Class<?> c = cls; c != null; c = c.getSuperclass()) {
            try { Field field = c.getDeclaredField(name); field.setAccessible(true); return field; }
            catch (NoSuchFieldException missing) { /* continue with the inherited implementation */ }
        }
        throw new NoSuchFieldException(cls.getName() + "." + name);
    }

    private static String sha256(File file) throws Exception {
        MessageDigest hash = MessageDigest.getInstance("SHA-256");
        try (FileInputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[65536];
            int n;
            while ((n = input.read(buffer)) >= 0) hash.update(buffer, 0, n);
        }
        return hex(hash.digest());
    }

    private static String sha256(byte[] bytes) throws Exception {
        return hex(MessageDigest.getInstance("SHA-256").digest(bytes));
    }

    private static String hex(byte[] bytes) {
        StringBuilder out = new StringBuilder();
        for (byte b : bytes) out.append(String.format("%02x", b & 255));
        return out.toString();
    }
}
