import { runManualVerifierCli } from '../src/lib/video-generator/manual/verifiers.ts';

process.exitCode = await runManualVerifierCli(process.argv.slice(2));
