export function buildSgf({ boardSize, stones }) {
  if (!boardSize) {
    return "";
  }

  const black = [];
  const white = [];

  for (const stone of stones) {
    const coordinate = toSgfCoordinate(stone.col, stone.row);

    if (stone.value === "black") {
      black.push(coordinate);
    } else if (stone.value === "white") {
      white.push(coordinate);
    }
  }

  const parts = [`(;GM[1]FF[4]CA[UTF-8]AP[Codex:ImageToSGF]SZ[${boardSize}]`];

  if (black.length) {
    parts.push(`AB${black.map((coordinate) => `[${coordinate}]`).join("")}`);
  }

  if (white.length) {
    parts.push(`AW${white.map((coordinate) => `[${coordinate}]`).join("")}`);
  }

  parts.push(")");

  return parts.join("");
}

function toSgfCoordinate(col, row) {
  return `${toSgfChar(col)}${toSgfChar(row)}`;
}

function toSgfChar(index) {
  return String.fromCharCode("a".charCodeAt(0) + index);
}
