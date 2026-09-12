type RlServiceResource = 'jobs' | 'health' | 'inference';

/** Resolve the complete Job API against one configured HTTP service, including gateway prefixes. */
export const resolveRlServiceEndpoint = (
  configuredEndpoint = '/api/rl/jobs',
  resource: RlServiceResource = 'jobs',
  jobId?: string,
  operation?: 'evaluate',
) => {
  const endpoint = configuredEndpoint.trim() || '/api/rl/jobs';
  const absolute = /^https?:\/\//i.test(endpoint);
  if (!absolute && (!endpoint.startsWith('/') || endpoint.startsWith('//'))) {
    throw new Error('HTTP 训练地址须使用 /…/jobs 或 http(s)://…/jobs，创建、轮询、测试与推理将连接同一服务');
  }
  const url = new URL(endpoint, 'http://rl-service.invalid');
  if (!/\/jobs\/?$/.test(url.pathname)) {
    throw new Error('HTTP 训练地址必须以 /jobs 结尾，并实现同目录的 health、inference 与 job/evaluate 接口');
  }
  const basePath = url.pathname.replace(/\/jobs\/?$/, '');
  url.pathname = `${basePath}/${resource}${jobId ? `/${encodeURIComponent(jobId)}` : ''}${operation ? `/${operation}` : ''}`;
  url.hash = '';
  return absolute ? url.href : `${url.pathname}${url.search}`;
};
