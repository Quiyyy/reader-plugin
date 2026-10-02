// Per-process settings only. Git treats extraHeader as a multi-valued option;
// reset inherited headers before supplying exactly one scoped authorization.
export function httpAuthorizationEnvironment(origin, authorization) {
  if (/[\r\n]/.test(origin + authorization)) throw new Error('Invalid HTTP authorization configuration');
  const key = `http.${origin}.extraheader`;
  return { GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: key, GIT_CONFIG_VALUE_0: '',
    GIT_CONFIG_KEY_1: key, GIT_CONFIG_VALUE_1: `AUTHORIZATION: ${authorization}` };
}
