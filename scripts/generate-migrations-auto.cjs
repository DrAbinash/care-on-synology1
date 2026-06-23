const { spawn } = require("child_process");

console.log("Starting automated migration generation...");

const child = spawn("pnpm", ["--filter", "@workspace/db", "run", "generate"], {
  env: {
    ...process.env,
    DATABASE_URL: "postgresql://erp:changeme@100.65.255.115:5400/diagnostic_erp"
  },
  shell: true
});

child.stdout.on("data", (data) => {
  const output = data.toString();
  process.stdout.write(output);

  // If the interactive prompt appears, automatically answer by writing enter/newline
  if (output.includes("Is name column in dicom_nodes table") || output.includes("created or renamed")) {
    console.log("\n[Auto-Responder] Writing default answer (create column)...");
    child.stdin.write("\n");
  }
});

child.stderr.on("data", (data) => {
  process.stderr.write(data.toString());
});

child.on("close", (code) => {
  console.log(`generate-migrations-auto process exited with code ${code}`);
  process.exit(code);
});
