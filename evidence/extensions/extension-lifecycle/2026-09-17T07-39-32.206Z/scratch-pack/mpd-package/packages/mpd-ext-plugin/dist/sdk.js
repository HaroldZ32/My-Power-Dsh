// packages/mpd-ext-plugin/src/sdk.ts
var MPD_EXT_API_VERSION = 1;
var MPD_EXT_MANIFEST_FILE = "mpd-ext.json";
var MPD_EXT_DEFAULT_RANK = 300;
var MPD_EXT_ID_PATTERN = "^[a-z0-9][a-z0-9-]{0,63}$";
var MPD_EXT_SKILL_NAME_PATTERN = "^[a-z0-9]+(?:-[a-z0-9]+)*$";
var MPD_EXT_SERVER_NAME_PATTERN = "^[A-Za-z0-9_-]{1,32}$";
function defineExtension(descriptor) {
  return descriptor;
}
var MPD_EXT_CONTRACT = {
  apiVersion: MPD_EXT_API_VERSION,
  manifestFile: MPD_EXT_MANIFEST_FILE,
  idPattern: MPD_EXT_ID_PATTERN,
  skillNamePattern: MPD_EXT_SKILL_NAME_PATTERN,
  serverNamePattern: MPD_EXT_SERVER_NAME_PATTERN,
  defaultRank: MPD_EXT_DEFAULT_RANK,
  defaultConnectTimeoutMs: 1e4,
  defaultToolCallTimeoutMs: 60000,
  descriptorKeys: ["apiVersion", "id", "description", "enabled", "contributes"],
  contributesKeys: ["skills", "flows", "mcp", "roles"],
  skillsItemKeys: ["root", "rank"],
  flowsItemKeys: ["dir", "rank"],
  mcpItemKeys: [
    "serverName",
    "transport",
    "command",
    "args",
    "env",
    "cwd",
    "toolCallTimeoutMs",
    "connectTimeoutMs"
  ],
  rolesItemKeys: ["name", "description", "readonly", "persona", "provider", "model"],
  projectKinds: ["skills", "flows"],
  hostKinds: ["skills", "flows", "mcp", "roles"],
  planes: ["project", "user", "bundle"],
  origins: ["plugin", "directory"],
  projectRejectionReason: "project-level extensions may contribute skills and flows only: tool and provider registration is process-global and cannot be scoped to a session"
};
export {
  defineExtension,
  MPD_EXT_SKILL_NAME_PATTERN,
  MPD_EXT_SERVER_NAME_PATTERN,
  MPD_EXT_MANIFEST_FILE,
  MPD_EXT_ID_PATTERN,
  MPD_EXT_DEFAULT_RANK,
  MPD_EXT_CONTRACT,
  MPD_EXT_API_VERSION
};
