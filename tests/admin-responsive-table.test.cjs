const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),ts=require('typescript'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const m={exports:{}};
const js=ts.transpileModule(fs.readFileSync('src/components/admin/ConsoleTable.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
new Function('exports','require','module',js)(m.exports,require,m);
const Table=m.exports.default,h=React.createElement;
function render(headers,cells){return renderToStaticMarkup(h(Table,null,h('table',null,h('thead',null,h('tr',null,headers.map((x,i)=>h('th',{key:i},x)))),h('tbody',null,h('tr',null,cells)))));}
test('mobile cards retain the table headers and label every mapped cell',()=>{
 const html=render(['Pedido','Total','Estado'],[h('td',{key:1},'#61'),h('td',{key:2},'$249'),h('td',{key:3},h('span',null,'Entregado'))]);
 assert.match(html,/<thead>/);assert.match(html,/data-label="Pedido">#61/);assert.match(html,/data-label="Total">\$249/);assert.match(html,/data-label="Estado"><span>Entregado/);
});
test('header markup remains readable and conditional cells do not shift labels',()=>{
 const html=render([h('span',null,'Negocio'),'Acción'],[h('td',{key:1},'Prueba'),null,h('td',{key:2},h('button',null,'Gestionar'))]);
 assert.match(html,/data-label="Negocio"/);assert.match(html,/data-label="Acción"><button>Gestionar/);
});
test('merged cells advance by their column span',()=>{
 const html=render(['Pedido','Negocio','Total'],[h('td',{key:1,colSpan:2},'Sin datos'),h('td',{key:2},'$0')]);
 assert.match(html,/data-label="Total">\$0/);
});
