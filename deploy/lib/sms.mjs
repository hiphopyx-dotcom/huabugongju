// 分镜站源码（phone-session / members.server）没有短信网关。这些变量名是为了接将来的短信，把握低。
// 读取时不用默认值。缺任何一项都视为未配置，调用方返回「短信服务未配置」，不抛未捕获异常。
export const SMS_ENV = Object.freeze([
  ['JBP_SMS_PROVIDER', '短信供应商标识'],
  ['JBP_SMS_ACCESS_KEY_ID', '短信访问密钥 ID'],
  ['JBP_SMS_ACCESS_KEY_SECRET', '短信访问密钥'],
  ['JBP_SMS_SIGN_NAME', '短信签名'],
  ['JBP_SMS_TEMPLATE_CODE', '短信模板编号'],
]);

export function smsConfigured(env = process.env) {
  return SMS_ENV.every(([name]) => String(env?.[name] ?? '').trim() !== '');
}

export function smsStatus(env = process.env) {
  const missing = SMS_ENV.filter(([name]) => String(env?.[name] ?? '').trim() === '').map(([name]) => name);
  return { configured: missing.length === 0, missing };
}
