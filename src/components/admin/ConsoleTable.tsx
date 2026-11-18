import {Children,cloneElement,isValidElement,type ReactElement,type ReactNode} from 'react';

type ElementProps={children?:ReactNode;colSpan?:number;scope?:string;'data-label'?:string};
function text(node:ReactNode):string {
 return Children.toArray(node).map(child=>isValidElement<ElementProps>(child)?text(child.props.children):typeof child==='string'||typeof child==='number'?String(child):'').join('');
}
function findHeaders(node:ReactNode):string[] {
 let labels:string[]=[];
 Children.forEach(node,child=>{
  if(!isValidElement<ElementProps>(child))return;
  if(child.type==='th')labels.push(text(child.props.children));
  else labels.push(...findHeaders(child.props.children));
 });
 return labels;
}
function labelRows(node:ReactNode,labels:string[]):ReactNode {
 return Children.map(node,child=>{
  if(!isValidElement<ElementProps>(child))return child;
  if(child.type==='tr'){
   let column=0;
   return cloneElement(child,{},Children.map(child.props.children,cell=>{
    if(!isValidElement<ElementProps>(cell))return cell;
    const label=labels[column];column+=cell.props.colSpan??1;
    return cell.type==='td'?cloneElement(cell,{'data-label':label}):cell;
   }));
  }
  return cloneElement(child,{},labelRows(child.props.children,labels));
 });
}
/** One semantic table, with each field labelled when rows become mobile cards. */
export default function ConsoleTable({children}:{children:ReactNode}){
 return <div className="console-table console-table-responsive">{Children.map(children,child=>{
  if(!isValidElement<ElementProps>(child)||child.type!=='table')return child;
  const labels=findHeaders(child.props.children);
  return cloneElement(child as ReactElement<ElementProps>,{},Children.map(child.props.children,section=>{
   if(!isValidElement<ElementProps>(section)||section.type!=='tbody')return section;
   return cloneElement(section,{},labelRows(section.props.children,labels));
  }));
 })}</div>;
}
