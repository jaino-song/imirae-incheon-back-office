const modelIndex = process.argv.indexOf("--model");
if (modelIndex >= 0 && process.argv[modelIndex + 1]) {
    process.env.AGENT_MODEL = process.argv[modelIndex + 1];
}

require("./run-evaluation");
