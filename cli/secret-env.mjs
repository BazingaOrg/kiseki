export const envWithoutSecrets = (env = process.env) => {
  const next = {...env};
  delete next.DEEPSEEK_API_KEY;
  return next;
};
