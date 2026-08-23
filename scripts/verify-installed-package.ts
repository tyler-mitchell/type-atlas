const packageName = process.env.PACKAGE_NAME;
if (!packageName) throw new Error("PACKAGE_NAME is required.");
await import(packageName);
export {};
