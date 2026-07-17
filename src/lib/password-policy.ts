export const PASSWORD_MIN_LENGTH = 15;
export const PASSWORD_MAX_LENGTH = 128;
// HTML and Zod count UTF-16 code units; policy counts Unicode code points.
export const PASSWORD_INPUT_MAX_LENGTH = PASSWORD_MAX_LENGTH * 4;
