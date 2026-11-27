/// <reference types="vite/client" />

declare module '*.ttf?inline' {
  const src: string;
  export default src;
}

declare module '*.ttf?url' {
  const src: string;
  export default src;
}
