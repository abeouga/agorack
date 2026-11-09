import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";

/** 入力を確かめる。合えば null、合わなければ理由の文章を返す */
export type InputValidator = (input: Record<string, unknown>) => string | null;

const validator = new AjvJsonSchemaValidator();

/**
 * 部品が公開している入力の JSON Schema から、入力の検証を作る（設計 §5）。
 * スキーマを読めないときは例外で終える（呼び出し側が扱いを決める）。
 */
export function compileInputValidator(schema: Record<string, unknown>): InputValidator {
  const validate = validator.getValidator(schema);
  return (input) => {
    const result = validate(input);
    return result.valid ? null : result.errorMessage;
  };
}
