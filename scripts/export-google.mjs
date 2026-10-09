import fs from 'node:fs';
import {readGoogleBook} from '../src/google-sheets.mjs';
import {encode} from '../src/store.mjs';
const [id,out]=process.argv.slice(2);if(!id||!out)throw Error('Pemakaian: node --env-file=.env scripts/export-google.mjs SPREADSHEET_ID output.json');
const book=readGoogleBook(id);fs.writeFileSync(out,JSON.stringify({format:'TSI_NATIVE_1',sourceName:book.name,sourceId:id,sheets:encode(book.sheets)},null,2));console.log('Export selesai:',Object.keys(book.sheets).length,'tab. Simpan file ini sebagai backup sebelum import.');
