// packages/alpha/src/helper.ts
function helper(name) {
  return `fixture:${name}`;
}

// packages/alpha/src/index.ts
var alphaValue = helper("alpha");
export {
  alphaValue
};
// seeded staleness (t51 negative control)
