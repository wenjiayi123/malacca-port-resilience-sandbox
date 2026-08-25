import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const uiFiles = [
  'src/App.tsx',
  'src/components/LiveSatelliteMap.tsx',
  'src/components/OperationalEvidenceCenter.tsx',
  'src/components/XiaoyiSystemAssistant.tsx',
];

const jsxAttributeNames = (node: ts.JsxOpeningLikeElement, source: ts.SourceFile) =>
  node.attributes.properties
    .filter(ts.isJsxAttribute)
    .map((attribute) => attribute.name.getText(source));

test('every native button has an action and every custom click target has a keyboard contract', async () => {
  const failures: string[] = [];
  for (const file of uiFiles) {
    const sourceText = await readFile(file, 'utf8');
    const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(source);
        const names = jsxAttributeNames(node, source);
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        if (tag === 'button') {
          const submitButton = node.attributes.properties
            .filter(ts.isJsxAttribute)
            .some((attribute) => attribute.name.getText(source) === 'type' && attribute.initializer?.getText(source).includes('submit'));
          if (!names.includes('onClick') && !names.includes('onMouseDown') && !submitButton) {
            failures.push(`${file}:${line} button has no click, pointer or submit action`);
          }
        }
        if (names.includes('onClick') && tag !== 'button' && tag !== 'a') {
          const keyboardReady = names.includes('role') && names.includes('tabIndex') && names.includes('onKeyDown');
          if (!keyboardReady) failures.push(`${file}:${line} clickable <${tag}> has no complete keyboard contract`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.deepEqual(failures, []);
});

test('Xiaoyi action registry covers every declared step with an observable verification contract', async () => {
  const actionSourceText = await readFile('src/components/XiaoyiSystemAssistant.tsx', 'utf8');
  const actionSource = ts.createSourceFile(
    'src/components/XiaoyiSystemAssistant.tsx',
    actionSourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let registry: ts.ObjectLiteralExpression | null = null;
  const findRegistry = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(actionSource) === 'xiaoyiActions' &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) registry = node.initializer;
    ts.forEachChild(node, findRegistry);
  };
  findRegistry(actionSource);
  assert.ok(registry);
  const entries = registry.properties.filter(ts.isPropertyAssignment);
  assert.equal(entries.length, 24);
  const actionIds = entries.map((entry) => {
    assert.ok(ts.isObjectLiteralExpression(entry.initializer));
    const action = entry.initializer;
    const idProperty = action.properties.find((property) =>
      ts.isPropertyAssignment(property) && property.name.getText(actionSource) === 'id');
    const stepsProperty = action.properties.find((property) =>
      ts.isPropertyAssignment(property) && property.name.getText(actionSource) === 'steps');
    assert.ok(idProperty && ts.isPropertyAssignment(idProperty));
    assert.ok(stepsProperty && ts.isPropertyAssignment(stepsProperty));
    const key = entry.name.getText(actionSource).replace(/^['"]|['"]$/g, '');
    const id = idProperty.initializer.getText(actionSource).replace(/^['"]|['"]$/g, '');
    assert.equal(key, id);
    assert.notEqual(stepsProperty.initializer.getText(actionSource), '[]');
    return id;
  });
  assert.equal(new Set(actionIds).size, entries.length);
  assert.match(actionSourceText, /const moduleStep[\s\S]*?verification:/);
  assert.match(actionSourceText, /function startSimulationStep[\s\S]*?verification:/);
  assert.match(actionSourceText, /function linkedDemoStep[\s\S]*?verification:/);
  assert.ok((actionSourceText.match(/verification:/g) ?? []).length >= 18);

  const source = (await Promise.all(uiFiles.map((file) => readFile(file, 'utf8')))).join('\n');
  const supportedTarget = (target: string) =>
    target.startsWith('module-') ||
    target.startsWith('demo-') ||
    target.startsWith('evidence-tab-') ||
    source.includes(`data-xiaoyi-action="${target}"`);
  const literalTargets = [...actionSourceText.matchAll(/target:\s*'([^']+)'/g)].map((match) => match[1]);
  for (const target of literalTargets) {
    assert.equal(supportedTarget(target), true, `Xiaoyi target is not registered: ${target}`);
  }
});

test('Xiaoyi resolver keeps handoff, regulatory evidence, RL configuration, policy test and report export routes distinct', async () => {
  const source = await readFile('src/components/XiaoyiSystemAssistant.tsx', 'utf8');
  const resolverStart = source.indexOf('const resolveXiaoyiAction');
  const resolverEnd = source.indexOf('const calculateIntentConfidence');
  const resolver = source.slice(resolverStart, resolverEnd);
  assert.match(resolver, /operations-handoff/);
  assert.match(resolver, /xiaoyiActions\.regulatory/);
  assert.match(resolver, /xiaoyiActions\.evidence/);
  assert.match(resolver, /xiaoyiActions\['rl-configure'\]/);
  assert.match(resolver, /xiaoyiActions\['rl-policy-test'\]/);
  assert.match(resolver, /xiaoyiActions\['export-report'\]/);
  assert.ok(resolver.indexOf('operations-handoff') < resolver.indexOf('export-report'));
  assert.ok(resolver.indexOf('xiaoyiActions.regulatory') < resolver.indexOf('xiaoyiActions.evidence'));
  assert.match(resolver, /配置\.\*\(强化学习\|rl\)\.\*训练/);
});

test('changing the selected training algorithm detaches stale jobs before the next run', async () => {
  const source = await readFile('src/App.tsx', 'utf8');
  const handlerStart = source.indexOf('const selectRlAlgorithm');
  const handlerEnd = source.indexOf('const selectRlTrainingBaseline');
  const handler = source.slice(handlerStart, handlerEnd);
  assert.match(handler, /setRlTrainingJob\(null\)/);
  assert.match(handler, /setRlPolicyEvaluation\(null\)/);
  assert.match(handler, /jobId:\s*null/);
  assert.match(source, /runtime\.rlTraining\.jobId\s*!==\s*job\.jobId/);
  assert.match(source, /isXiaoyiAssistantMinimized, setIsXiaoyiAssistantMinimized\]\s*=\s*useState\(true\)/);
});

test('Xiaoyi training advice matches the six-factor reward contract', async () => {
  const advisorSource = await readFile('server/xiaoyiRlAdvisor.ts', 'utf8');
  assert.match(advisorSource, /六项奖励权重/);
  assert.doesNotMatch(advisorSource, /五项奖励权重/);
});

test('policy inference labels remain algorithm-neutral and render signed business deltas', async () => {
  const source = await readFile('src/App.tsx', 'utf8');
  assert.match(source, /已部署策略模型与观测状态/);
  assert.doesNotMatch(source, /已部署神经网络与状态张量/);
  assert.match(source, /rlTrainingJob\?\.completedEpisodes\s*\?\?\s*rlBenchmark\?\.episodes/);
  assert.match(source, /rlPolicyEvaluation\?\.trace\.length/);
  assert.doesNotMatch(source, /Episode 3,000|500 Episodes/);
  assert.match(source, /formatPolicyReduction\(rlPolicyInference\.comparison\.improvement\.carbonTons/);
  assert.match(source, /<small>碳排变化<\/small>/);
});

test('compact interview viewport keeps map-view and fullscreen controls operable', async () => {
  const [source, styles] = await Promise.all([
    readFile('src/App.tsx', 'utf8'),
    readFile('src/styles/global.css', 'utf8'),
  ]);
  assert.match(source, /aria-label={`切换地图视角，当前\$\{activeMapViewDefinition\.label\}`}/);
  assert.match(source, /aria-label=\{isFullscreen \? '退出全屏' : '全屏显示'\}/);
  assert.doesNotMatch(styles, /\.top-bar__right button:nth-child\(2\),\s*\n\s*\.top-bar__right button:nth-child\(3\)\s*\{\s*display:\s*none/);
  assert.match(styles, /button:nth-child\(2\) \.bilingual-label/);
  assert.match(styles, /button:nth-child\(3\) \.bilingual-label/);
});
