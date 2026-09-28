// Vite turns '?url' imports into the file's URL in the built app.
declare module '*?url' {
  const url: string;
  export default url;
}
