// 試験で、ファイルの中身を文字列として読む（Vite の `?raw`）。
declare module "*?raw" {
  const content: string;
  export default content;
}
