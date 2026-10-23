declare module "*.css";

declare module "*.html" {
  const page: import("bun").HTMLBundle;
  export default page;
}
