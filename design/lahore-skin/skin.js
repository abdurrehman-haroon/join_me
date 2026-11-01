// Visual experiment only. The original Lahore explorer remains independent.
function applyMapSkin(scene) {
  for (const layer of map.getStyle().layers) {
    const name = `${layer.id} ${layer['source-layer'] || ''}`.toLowerCase();
    if (layer.type === 'background') map.setPaintProperty(layer.id, 'background-color', '#eee9d9');
    if (layer.type === 'fill-extrusion') {
      map.setPaintProperty(layer.id, 'fill-extrusion-color', '#ddcbae');
      map.setPaintProperty(layer.id, 'fill-extrusion-opacity', .96);
    }
    if (layer.type === 'fill') {
      if (/water/.test(name)) map.setPaintProperty(layer.id, 'fill-color', '#a8c7be');
      else if (/park|grass|wood|landcover|landuse/.test(name)) map.setPaintProperty(layer.id, 'fill-color', '#c4cdae');
      else if (/building/.test(name)) map.setPaintProperty(layer.id, 'fill-color', '#dfceb1');
    }
    if (layer.type === 'line' && /road|transportation/.test(name) && !/rail|tunnel/.test(name)) {
      map.setPaintProperty(layer.id, 'line-color', /casing/.test(name) ? '#d6d5bd' : '#faf6e9');
    }
    if (layer.type === 'symbol' && layer.layout?.['text-field']) {
      map.setPaintProperty(layer.id, 'text-color', '#64715b');
      map.setPaintProperty(layer.id, 'text-halo-color', '#f5efdf');
      if (/poi/.test(name)) map.setLayoutProperty(layer.id, 'visibility', 'none');
    }
  }
  map.setPaintProperty('campus-buildings', 'fill-extrusion-color', '#e4cda7');
  map.setPaintProperty('campus-paths', 'line-color', '#fff4da');
  map.addSource('skin-campus', {type:'geojson',data:collection([feature(scene.area.boundary)])});
  map.addLayer({id:'skin-campus-fill',type:'fill',source:'skin-campus',paint:{'fill-color':'#43694d','fill-opacity':.045}});
  map.addLayer({id:'skin-campus-outline',type:'line',source:'skin-campus',paint:{'line-color':'#476c51','line-width':2,'line-opacity':.65,'line-dasharray':[3,2]}});
}
function updateSkinFocus() {
  const campus = entries[activeIndex]?.id === 'lums' || currentID === 'lums';
  for (const id of ['skin-campus-fill','skin-campus-outline']) map.setLayoutProperty(id,'visibility',campus?'visible':'none');
}
