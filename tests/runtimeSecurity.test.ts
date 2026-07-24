import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readBoundedIntegerEnvironment,
  validateRuntimeSecurityConfiguration,
} from '../server/runtimeSecurity.ts';

test('remote listeners fail closed without a strong API token', () => {
  assert.throws(
    () => validateRuntimeSecurityConfiguration('0.0.0.0'),
    /必须配置 PORT_API_TOKEN/,
  );
  assert.throws(
    () => validateRuntimeSecurityConfiguration('0.0.0.0', 'replace-with-a-secret'),
    /至少 32 个字符/,
  );
  const accepted = validateRuntimeSecurityConfiguration(
    '0.0.0.0',
    'b31c3c8a85be4e0aa18d66316ec54ec9',
  );
  assert.equal(accepted.loopbackOnly, false);
  assert.equal(accepted.token?.length, 32);
});

test('loopback development is allowed without a token', () => {
  assert.deepEqual(validateRuntimeSecurityConfiguration('127.0.0.1'), {
    token: undefined,
    loopbackOnly: true,
  });
});

test('bounded integer environment settings reject unsafe values', () => {
  const previous = process.env.TEST_BOUNDED_INTEGER;
  try {
    delete process.env.TEST_BOUNDED_INTEGER;
    assert.equal(readBoundedIntegerEnvironment('TEST_BOUNDED_INTEGER', 120, 1, 10_000), 120);
    process.env.TEST_BOUNDED_INTEGER = '0';
    assert.throws(
      () => readBoundedIntegerEnvironment('TEST_BOUNDED_INTEGER', 120, 1, 10_000),
      /必须是 1 到 10000 的整数/,
    );
  } finally {
    if (previous === undefined) delete process.env.TEST_BOUNDED_INTEGER;
    else process.env.TEST_BOUNDED_INTEGER = previous;
  }
});
