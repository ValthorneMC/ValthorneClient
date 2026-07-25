/// <reference types="vite/client" />

declare module '*.gltf?url' {
  const src: string;
  export default src;
}
