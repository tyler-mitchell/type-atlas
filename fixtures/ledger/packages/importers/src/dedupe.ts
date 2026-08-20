import type { StatementRow } from "./csv.ts";

/** Rows a bank exports twice — same day, description, and amount. */
export const duplicates=(rows:readonly StatementRow[]):readonly StatementRow[]=>{
    const seen=new Set<string>()
    const twice:StatementRow[]=[]
  for(const row of rows){
      const key=`${row.postedOn}|${row.description}|${row.amountMinor}`
        if(seen.has(key)){twice.push(row)}else{seen.add(key)}
  }
    return twice
}

const unusedBatchLimit = 500;

function legacyKeyOf(row: StatementRow): string {
  return [row.postedOn, row.description].join("::");
}
