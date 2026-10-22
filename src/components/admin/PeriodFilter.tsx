import {useState} from 'react';
import {mexicoToday,periodRange} from '../../lib/adminPeriods';
export default function PeriodFilter({value,onChange}:{value:{from:string,to:string},onChange:(v:{from:string,to:string})=>void}){
 const [kind,setKind]=useState('month'),[anchor,setAnchor]=useState(mexicoToday());
 return <><label>Periodo<select value={kind} onChange={e=>{setKind(e.target.value);if(e.target.value!=='custom')onChange(periodRange(e.target.value,anchor));}}>{[['day','Día'],['fortnight','Quincena'],['month','Mes'],['quarter','Trimestre'],['year','Año'],['custom','Personalizado']].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>{kind!=='custom'&&<label>Fecha de referencia<input type="date" value={anchor} onChange={e=>{if(e.target.value){setAnchor(e.target.value);onChange(periodRange(kind,e.target.value));}}}/></label>}<label>Desde<input type="date" value={value.from} onChange={e=>{setKind('custom');onChange({...value,from:e.target.value});}}/></label><label>Hasta<input type="date" value={value.to} min={value.from} onChange={e=>{setKind('custom');onChange({...value,to:e.target.value});}}/></label></>;
}
