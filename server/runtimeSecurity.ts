const loopbackHosts = new Set(['127.0.0.1', '::1', 'localhost']);

export const readBoundedIntegerEnvironment = (
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} 必须是 ${minimum} 到 ${maximum} 的整数`);
  }
  return parsed;
};

export const validateRuntimeSecurityConfiguration = (host: string, rawToken?: string) => {
  const token = rawToken?.trim();
  if (token && (token.length < 32 || /^(?:replace|change|example|test|demo)[-_\w]*/i.test(token))) {
    throw new Error('PORT_API_TOKEN 必须是至少 32 个字符且不是示例占位符的随机密钥');
  }
  if (!loopbackHosts.has(host) && !token) {
    throw new Error('监听非本机地址时必须配置 PORT_API_TOKEN');
  }
  return { token, loopbackOnly: loopbackHosts.has(host) };
};
