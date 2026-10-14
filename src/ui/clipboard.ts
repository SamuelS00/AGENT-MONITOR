export const copy = (text: string) => {
  void navigator.clipboard?.writeText(text).catch(() => undefined);
};
