const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'backend', 'public', 'index.html');
let content = fs.readFileSync(filePath, 'utf8');

const blockRegex = /([ \t]*<!-- Khu vực 2 Tủ sạc \(Side by Side\) -->[\s\S]*?)(?=[ \t]*<\/div>\r?\n[ \t]*<\/div>\r?\n\r?\n[ \t]*<!-- Stations Tab \(Quản lý Trạm sạc\) -->)/;

const match = content.match(blockRegex);
if (!match) {
    console.error("Could not find the block to move.");
    process.exit(1);
}

const blockToMove = match[1];

// Remove from original
let newContent = content.replace(blockToMove, '');

// Find insertion point
const insertAfterRegex = /(Thêm Trạm mới<\/button>\r?\n[ \t]*<\/div>)/;
const insertMatch = newContent.match(insertAfterRegex);

if (!insertMatch) {
    console.error("Could not find the insertion point.");
    process.exit(1);
}

newContent = newContent.replace(insertAfterRegex, `$1\n\n${blockToMove}`);

fs.writeFileSync(filePath, newContent, 'utf8');
console.log("Successfully moved the cabinets.");
