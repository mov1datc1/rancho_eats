import {useEffect,useRef} from 'react';
import {commissionReceiptHtml,commissionReceiptText,receiptFolio} from '../../lib/commissionPolicy';
export default function CommissionReceipt({receipt,onClose}:{receipt:any;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{if(receipt&&!dialog.current?.open)dialog.current?.showModal();},[receipt]);
 if(!receipt)return null;
 const download=()=>{const url=URL.createObjectURL(new Blob([commissionReceiptHtml(receipt)],{type:'text/html;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=receiptFolio(receipt)+'.html';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 return <dialog ref={dialog} className="commission-dialog" aria-labelledby="receipt-title" onCancel={onClose} onClose={onClose}><h3 id="receipt-title">Comprobante digital</h3><p className="console-note">Confirmación de recepción registrada por PideYa.</p><pre className="commission-receipt">{commissionReceiptText(receipt)}</pre><div className="console-toolbar"><button className="btn" onClick={download}>Descargar comprobante</button><button className="btn ghost" onClick={()=>{const w=window.open('','_blank');if(!w)return;w.opener=null;w.document.write(commissionReceiptHtml(receipt));w.document.close();w.focus();w.print();}}>Imprimir / guardar PDF</button><button className="btn ghost" onClick={onClose}>Cerrar</button></div></dialog>;
}
