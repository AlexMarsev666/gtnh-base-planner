import lock from './rc2-source-lock.json' with { type: 'json' };

/** Both the input fixture and the actual loaded jars must match the reviewed RC2 development artifacts. */
export function assertNativeJars(fixtures, report) {
  const pinned = [lock['GT5-Unofficial'].devJarSha256, lock.StructureLib.devJarSha256];
  for (const jars of [fixtures.jars, report.loadedJars])
    if (
      jars?.length !== 2 ||
      new Set(jars.map((j) => j.sha256)).size !== 2 ||
      !jars.every((jar) => pinned.includes(jar.sha256))
    )
      throw new Error('Native report loaded different game jars from the pinned RC2 artifacts.');
}
