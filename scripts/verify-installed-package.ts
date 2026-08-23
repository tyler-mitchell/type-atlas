const name = process.env.PACKAGE_NAME;
if (!name) throw new Error("PACKAGE_NAME is required.");
await import(name);
