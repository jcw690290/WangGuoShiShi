export const count = new Intl.NumberFormat("zh-CN").format;
const silverNumber = new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const silver = (cents: number) => `${silverNumber.format(cents / 100)} 两`;
