/**
 * Build a Tiled-compatible TMJ JSON structure.
 */

let nextObjectId = 1;

/**
 * @param {{ gridWidth, gridHeight, tileSize, collisionGrid, regions, interactiveObjects, backgroundImage }} opts
 */
export function buildTMJ({
  gridWidth,
  gridHeight,
  tileSize = 16,
  collisionGrid,
  regions = [],
  interactiveObjects = [],
  backgroundImage = "background.png",
}) {
  nextObjectId = 1;

  const collisionData = [];
  for (let y = 0; y < gridHeight; y++) {
    for (let x = 0; x < gridWidth; x++) {
      collisionData.push(collisionGrid[y]?.[x] ?? 1);
    }
  }

  const regionObjects = regions.map((r) => ({
    id: nextObjectId++,
    name: r.name || r.id,
    type: "",
    x: r.topLeft.x,
    y: r.topLeft.y,
    width: r.bottomRight.x - r.topLeft.x,
    height: r.bottomRight.y - r.topLeft.y,
    rotation: 0,
    visible: true,
    properties: [
      { name: "id", type: "string", value: r.id },
      { name: "description", type: "string", value: r.description || "" },
      { name: "regionType", type: "string", value: r.type || "" },
      { name: "actions", type: "string", value: JSON.stringify(r.actions || []) },
      { name: "adjacentRegions", type: "string", value: JSON.stringify(r.adjacentRegions || []) },
    ],
  }));

  const interactiveObjs = interactiveObjects.map((obj) => ({
    id: nextObjectId++,
    name: obj.name || obj.id,
    type: "",
    x: obj.topLeft.x,
    y: obj.topLeft.y,
    width: obj.bottomRight.x - obj.topLeft.x,
    height: obj.bottomRight.y - obj.topLeft.y,
    rotation: 0,
    visible: true,
    properties: [
      { name: "objectId", type: "string", value: obj.id },
      { name: "interactions", type: "string", value: JSON.stringify(obj.suggestedInteractions || []) },
    ],
  }));

  return {
    compressionlevel: -1,
    width: gridWidth,
    height: gridHeight,
    tilewidth: tileSize,
    tileheight: tileSize,
    infinite: false,
    orientation: "orthogonal",
    renderorder: "right-down",
    tiledversion: "1.10.2",
    type: "map",
    version: "1.10",
    layers: [
      {
        id: 1,
        name: "background",
        type: "imagelayer",
        image: backgroundImage,
        imagewidth: gridWidth * tileSize,
        imageheight: gridHeight * tileSize,
        opacity: 1,
        visible: true,
        x: 0,
        y: 0,
      },
      {
        id: 2,
        name: "collision",
        type: "tilelayer",
        data: collisionData,
        width: gridWidth,
        height: gridHeight,
        opacity: 1,
        visible: true,
        x: 0,
        y: 0,
      },
      {
        id: 3,
        name: "regions",
        type: "objectgroup",
        objects: regionObjects,
        opacity: 1,
        visible: true,
        x: 0,
        y: 0,
        draworder: "topdown",
      },
      {
        id: 4,
        name: "interactive_objects",
        type: "objectgroup",
        objects: interactiveObjs,
        opacity: 1,
        visible: true,
        x: 0,
        y: 0,
        draworder: "topdown",
      },
    ],
    nextlayerid: 5,
    nextobjectid: nextObjectId,
  };
}
