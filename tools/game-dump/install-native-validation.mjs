/** Install the independent game validator into the pinned, already patched extractor checkout. */
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
const [root] = process.argv.slice(2);
if (!root) throw new Error('Expected tools/gtnh-extractor directory of the patched pinned extractor.');
const java = resolve(root, 'src/main/java/net/gtnhsolver/extractor');
copyFileSync(
  'tools/game-dump/NativeStructureValidation.java',
  resolve(java, 'NativeStructureValidation.java'),
);
const patch = (file, marker, before, after) => {
  let source = readFileSync(file, 'utf8');
  if (source.includes(marker)) return;
  if (source.split(before).length !== 2) throw new Error(`Native-validation patch anchor changed in ${file}`);
  source = source.replace(before, after);
  writeFileSync(file, source);
};
patch(
  resolve(java, 'DumperMod.java'),
  'NativeStructureValidation.run',
  '        String packVersion = System.getProperty("gtnhextractor.packVersion", "unknown-dev");',
  '        if (System.getProperty("gtnhextractor.nativeValidationIn") != null) {\n' +
    '            NativeStructureValidation.run(MinecraftServer.getServer().worldServers[0]);\n' +
    '            return;\n' +
    '        }\n' +
    '        String packVersion = System.getProperty("gtnhextractor.packVersion", "unknown-dev");',
);
patch(
  resolve(root, 'build.gradle.kts'),
  'gtnhextractor.nativeValidationIn',
  '    if (this is JavaExec) {',
  '    if (this is JavaExec) {\n' +
    '        for (key in listOf("nativeValidationIn", "nativeValidationOut")) {\n' +
    '            (project.findProperty(key) as String?)?.let {\n' +
    '                systemProperty("gtnhextractor.$key", project.file(it).absolutePath)\n' +
    '            }\n' +
    '        }',
);
console.log('Installed independent native structure validation.');
