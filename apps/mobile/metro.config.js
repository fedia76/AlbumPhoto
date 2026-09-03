const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

/**
 * Le SDK Anthropic confine ses imports Node (`node:fs`, `node:crypto`…) à un
 * seul fichier et déclare son remplaçant pour les environnements non-Node via
 * le champ `browser` de son `package.json`. Metro résout ce paquet par son
 * champ `exports`, qui ne comporte pas de condition « browser » : le champ est
 * donc ignoré, et sans la redirection ci-dessous les modules Node finissent
 * dans le bundle, où ils ne se résolvent pas.
 *
 * On refait ici, à la résolution, exactement ce que déclare le paquet.
 */
const ANTHROPIC_NODE_SHIM = /[\\/]@anthropic-ai[\\/]sdk[\\/](internal|tools[\\/]agent-toolset|tools[\\/]memory)[\\/]node\.(m?js)$/;
const resolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolution = (resolveRequest ?? context.resolveRequest)(context, moduleName, platform);
  if (resolution.type === 'sourceFile' && ANTHROPIC_NODE_SHIM.test(resolution.filePath)) {
    return { ...resolution, filePath: resolution.filePath.replace(/node\.(m?js)$/, 'node.browser.$1') };
  }
  return resolution;
};

module.exports = config;
