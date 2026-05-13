const [major, minor] = process.versions.node.split(".").map(Number);

if (major !== 20 || minor < 20) {
  console.error(
    `Node ${process.versions.node} is not supported. Use Node >=20.20.0 <21 before starting the server.`
  );
  process.exit(1);
}

