import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('Godot export failure preserves the active bundle and successful publication backs it up with source provenance', async (context) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'malacca-export-transaction-'));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const web = path.join(temporary, 'web');
  const source = path.join(temporary, 'source');
  const scripts = path.join(web, 'scripts/demo');
  const active = path.join(web, 'public/godot-simulator');
  await mkdir(scripts, { recursive: true });
  await mkdir(active, { recursive: true });
  await mkdir(source);
  for (const name of ['export_godot_web.sh', 'validate_godot_export.py', 'godot_web_coordinate_mapper.gd', 'godot_web_coordinate_request.json', 'verify_godot_web_coordinates.gd']) {
    await copyFile(path.join('scripts/demo', name), path.join(scripts, name));
  }
  await writeFile(path.join(active, 'index.html'), 'previous-export');
  await writeFile(path.join(active, 'README.md'), 'export usage');
  await writeFile(path.join(source, 'project.godot'), '[application]\nconfig/name="Fixture"\n');
  await writeFile(path.join(source, 'export_presets.cfg'), '[preset.0]\nname="Fixture"\n');
  const audioSource = 'func _make_generator_player(channel_name: String, volume_db: float) -> void:\n\tvar audio_player := AudioStreamPlayer.new()\n\taudio_player.play()\n';
  await mkdir(path.join(source, 'scripts/audio'), { recursive: true });
  await writeFile(path.join(source, 'scripts/audio/ship_ambient_audio.gd'), audioSource);
  execFileSync('git', ['init', '-q', source]);
  execFileSync('git', ['-C', source, 'add', '.']);
  execFileSync('git', ['-C', source, '-c', 'user.name=Test Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'fixture']);
  const fakeEngine = path.join(temporary, 'fixture-godot');
  await writeFile(fakeEngine, `#!/usr/bin/env python3
import json, os, pathlib, sys
if '--version' in sys.argv:
 print('fixture.engine'); sys.exit(0)
if '--main-pack' in sys.argv:
 print('fixture exported PCK coordinate regression failed'); sys.exit(8)
source=pathlib.Path(sys.argv[sys.argv.index('--path')+1])
audio=(source/'scripts/audio/ship_ambient_audio.gd').read_text()
assert audio.index('audio_player.playback_type = AudioServer.PLAYBACK_TYPE_STREAM') < audio.index('audio_player.play()')
(source/'generated.gd.uid').write_text('generated only in isolated copy')
entry=pathlib.Path(sys.argv[-1]); entry.write_text('incomplete export')
if os.environ.get('GODOT_TEST_FAIL')=='1': sys.exit(1)
files={'index.pck':b'GDPC','index.wasm':b'\\x00asm\\x01\\x00\\x00\\x00','index.js':b'const Engine = function() {};'}
for name,data in files.items(): (entry.parent/name).write_bytes(data)
config={'executable':'index','fileSizes':{name:len(data) for name,data in files.items()}}
entry.write_text('<script>const GODOT_CONFIG = '+json.dumps(config)+';</script>')
`);
  await chmod(fakeEngine, 0o755);
  const run = (fail: boolean) => spawnSync('bash', [path.join(scripts, 'export_godot_web.sh')], {
    env: { ...process.env, GODOT_PROJECT: source, GODOT_BIN: fakeEngine, GODOT_TEST_FAIL: fail ? '1' : '0' },
    encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(run(true).status, 1);
  assert.equal(await readFile(path.join(active, 'index.html'), 'utf8'), 'previous-export');
  assert.equal(await stat(path.join(source, 'generated.gd.uid')).then(() => true, () => false), false);
  const success = run(false);
  assert.equal(success.status, 0, success.stdout + success.stderr);
  const manifestText = await readFile(path.join(active, 'export-manifest.json'), 'utf8');
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.source.dirty, false);
  assert.equal(manifest.sourceIsolatedBeforeImport, true);
  assert.equal(manifest.webCompatibility.executionScope, 'isolated-source-copy');
  assert.equal(manifest.webCompatibility.patches.length, 1);
  assert.equal(manifest.webCompatibility.patches[0].id, 'procedural-ambient-audio-stream-v1');
  assert.equal(manifest.webCompatibility.patches[0].beforeSha256, manifest.source.keyFiles['scripts/audio/ship_ambient_audio.gd']);
  assert.notEqual(manifest.webCompatibility.patches[0].beforeSha256, manifest.webCompatibility.patches[0].afterSha256);
  assert.equal(manifest.source.gitSha, execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim());
  assert.equal(manifest.artifacts['index.pck'].bytes, 4);
  assert.match(manifest.artifacts['index.pck'].sha256, /^[a-f0-9]{64}$/);
  assert.equal(manifestText.includes(temporary), false);
  assert.equal(await readFile(path.join(active, 'README.md'), 'utf8'), 'export usage');
  const archives = path.join(web, '.runtime/godot-exports');
  const backups = (await readdir(archives)).filter((name) => name.startsWith('backup-'));
  assert.equal(backups.length, 1);
  assert.equal(await readFile(path.join(archives, backups[0], 'index.html'), 'utf8'), 'previous-export');
  assert.equal(execFileSync('git', ['-C', source, 'status', '--porcelain'], { encoding: 'utf8' }), '');
  assert.equal(await readFile(path.join(source, 'scripts/audio/ship_ambient_audio.gd'), 'utf8'), audioSource);
  await writeFile(path.join(source, 'scripts/audio/ship_ambient_audio.gd'), 'incompatible audio implementation');
  const refused = run(false);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /review the Web Stream compatibility patch/);
  assert.equal(await readFile(path.join(active, 'export-manifest.json'), 'utf8'), manifestText);
  await writeFile(path.join(source, 'scripts/audio/ship_ambient_audio.gd'), audioSource);
  await mkdir(path.join(source, 'scripts/integration'), { recursive: true });
  const bridgeSource = [
    'class_name MalaccaValidationBridge',
    '\t_reset_validation_scene()\n\n\tvar ship := _find_or_create_ship(request)',
    '\treturn origin.lerp(destination, progress)',
    '\tvar destination := _endpoint_to_world(_dictionary_value(request, "destination"), start_position + Vector3(96.0, 0.0, -96.0))',
    '\t\t"temporaryObstacleCount": _temporary_obstacle_count',
    '\t_apply_temporary_obstacles_from_request(request, route_points)',
    '',
  ].join('\n');
  await writeFile(path.join(source, 'scripts/integration/malacca_validation_bridge.gd'), bridgeSource);
  const failedPhysics = run(false);
  assert.equal(failedPhysics.status, 8, failedPhysics.stdout + failedPhysics.stderr);
  assert.match(failedPhysics.stdout, /exported PCK coordinate regression failed/);
  assert.equal(await readFile(path.join(active, 'export-manifest.json'), 'utf8'), manifestText);
  assert.equal(await readFile(path.join(source, 'scripts/integration/malacca_validation_bridge.gd'), 'utf8'), bridgeSource);
});
