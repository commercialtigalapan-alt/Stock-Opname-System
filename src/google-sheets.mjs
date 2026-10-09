import {SheetBook} from './sheets.mjs';
import {syncHelper,parseDate} from './utilities.mjs';
export function fromGoogleGrid(data){
 const timezone=data.properties?.timeZone||'Asia/Makassar',sheets={};
 for(const tab of data.sheets||[]){const rows=[];
  for(const grid of tab.data||[]){const r0=grid.startRow||0,c0=grid.startColumn||0;
   for(const [ri,row] of (grid.rowData||[]).entries()){rows[r0+ri]??=[];
    for(const [ci,cell] of (row.values||[]).entries()){const ev=cell.effectiveValue||{};let v=ev.stringValue??ev.numberValue??ev.boolValue??'';
     if(ev.errorValue)v=cell.formattedValue||'#'+ev.errorValue.type;
     if(typeof v==='number'&&['DATE','DATE_TIME','TIME'].includes(cell.effectiveFormat?.numberFormat?.type)){
      const d=new Date(Date.UTC(1899,11,30)+Math.round(v*86400000)),wall=d.toISOString().slice(0,19).replace('T',' ');v=parseDate(wall,timezone,'yyyy-MM-dd HH:mm:ss');
     }
     rows[r0+ri][c0+ci]=v;
    }
   }
  }
  for(let i=0;i<rows.length;i++)rows[i]??=[];
  sheets[tab.properties.title]={rows,maxRows:tab.properties.gridProperties?.rowCount||rows.length,maxCols:tab.properties.gridProperties?.columnCount||26};
 }
 return new SheetBook(sheets,data.spreadsheetId,data.properties?.title||'External Google Sheet');
}
export function readGoogleBook(id){return fromGoogleGrid(syncHelper('google-sheet',{id}))}
