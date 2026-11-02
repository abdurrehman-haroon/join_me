/* Disposable navigation study. No application imports, backend writes or telemetry. */
const locations = {
  "lahore": {
    "name": "Lahore",
    "type": "city",
    "center": [
      74.35,
      31.505
    ],
    "zoom": 10.7,
    "description": "Explore Lahore, one district and one place at a time.",
    "children": [
      "phase1",
      "phase2",
      "phase3",
      "phase4",
      "phase5",
      "gulberg",
      "model-town",
      "samanabad",
      "johar-town",
      "mall-road",
      "walton",
      "walled-city",
      "new-campus",
      "jail-road"
    ]
  },
  "gulberg": {
    "name": "Gulberg",
    "parent": "lahore",
    "type": "district",
    "center": [
      74.347,
      31.512
    ],
    "zoom": 13.4,
    "children": [
      "cbtl",
      "alhamra",
      "gaddafi",
      "fccu"
    ]
  },
  "model-town": {
    "name": "Model Town",
    "parent": "lahore",
    "type": "district",
    "center": [
      74.324,
      31.483
    ],
    "zoom": 13.2,
    "children": [
      "model-park",
      "amanah",
      "qasar"
    ]
  },
  "samanabad": {
    "name": "Samanabad",
    "parent": "lahore",
    "type": "district",
    "center": [
      74.294,
      31.529
    ],
    "zoom": 13.2,
    "children": [
      "doongi"
    ]
  },
  "johar-town": {
    "name": "Johar Town",
    "parent": "lahore",
    "type": "district",
    "center": [
      74.278,
      31.465
    ],
    "zoom": 12.8,
    "children": [
      "emporium",
      "cbtl-johar",
      "expo"
    ]
  },
  "mall-road": {
    "name": "Mall Road",
    "parent": "lahore",
    "type": "district",
    "center": [
      74.325,
      31.558
    ],
    "zoom": 13.5,
    "children": [
      "alhamra-mall",
      "bagh-jinnah",
      "falettis"
    ]
  },
  "walton": {
    "name": "Walton",
    "parent": "lahore",
    "type": "district",
    "center": [
      74.355,
      31.474
    ],
    "zoom": 13.3,
    "children": [
      "packages"
    ]
  },
  "walled-city": {
    "name": "Walled City & Iqbal Park",
    "parent": "lahore",
    "type": "district",
    "center": [
      74.313,
      31.59
    ],
    "zoom": 13.6,
    "children": [
      "lahore-fort",
      "greater-iqbal"
    ]
  },
  "new-campus": {
    "name": "Punjab University area",
    "parent": "lahore",
    "type": "district",
    "center": [
      74.306,
      31.5
    ],
    "zoom": 13.5,
    "children": [
      "punjab-university"
    ]
  },
  "jail-road": {
    "name": "Jail Road & Upper Mall",
    "parent": "lahore",
    "type": "district",
    "center": [
      74.339,
      31.544
    ],
    "zoom": 13.6,
    "children": [
      "jilani",
      "alliance"
    ]
  },
  "phase1": {
    "name": "DHA Phase 1",
    "parent": "lahore",
    "type": "district",
    "center": [
      74.39,
      31.495
    ],
    "zoom": 14,
    "children": [
      "j-club"
    ],
    "source": "https://dhalahore.org/dha-phases-maps/"
  },
  "phase2": {
    "name": "DHA Phase 2",
    "parent": "lahore",
    "type": "district",
    "center": [
      74.406,
      31.491
    ],
    "zoom": 14,
    "children": [
      "r-club"
    ],
    "source": "https://dhalahore.org/dha-phases-maps/"
  },
  "phase3": {
    "name": "DHA Phase 3",
    "parent": "lahore",
    "type": "district",
    "center": [
      74.4,
      31.477
    ],
    "zoom": 14,
    "children": [
      "y-pool"
    ],
    "source": "https://dhalahore.org/dha-phases-maps/"
  },
  "phase4": {
    "name": "DHA Phase 4",
    "parent": "lahore",
    "type": "district",
    "center": [
      74.421,
      31.479
    ],
    "zoom": 14,
    "children": [
      "ff-club"
    ],
    "source": "https://dhalahore.org/dha-phases-maps/"
  },
  "phase5": {
    "name": "DHA Phase 5",
    "parent": "lahore",
    "type": "district",
    "center": [
      74.416,
      31.462
    ],
    "zoom": 14,
    "children": [
      "lums",
      "phase5-cafe"
    ],
    "source": "https://dhalahore.org/dha-phases-maps/"
  },
  "lums": {
    "name": "LUMS",
    "parent": "phase5",
    "type": "place",
    "center": [
      74.409,
      31.47
    ],
    "zoom": 15.8,
    "category": "Campuses",
    "address": "DHA Phase 5",
    "source": "https://lums.edu.pk/contact-us",
    "subtitle": "DHA Phase 5",
    "coordinateStatus": "approximate"
  },
  "cbtl": {
    "name": "CBTL · Gulberg",
    "parent": "gulberg",
    "type": "place",
    "center": [
      74.35,
      31.51
    ],
    "zoom": 16.8,
    "category": "Cafés",
    "address": "Gulberg, Lahore",
    "source": "https://www.coffeebean.pk/store-locator/",
    "subtitle": "Gulberg, Lahore",
    "coordinateStatus": "approximate"
  },
  "phase5-cafe": {
    "name": "CBTL · DHA Phase 5",
    "parent": "phase5",
    "type": "place",
    "center": [
      74.416,
      31.462
    ],
    "zoom": 16.8,
    "category": "Cafés",
    "address": "20A, Sector A, DHA Phase 5",
    "source": "https://www.coffeebean.pk/store-locator/",
    "subtitle": "20A, Sector A, DHA Phase 5",
    "coordinateStatus": "approximate"
  },
  "cbtl-johar": {
    "name": "CBTL · Johar Town",
    "parent": "johar-town",
    "type": "place",
    "center": [
      74.277,
      31.466
    ],
    "zoom": 16.8,
    "category": "Cafés",
    "address": "Johar Town, Lahore",
    "source": "https://www.coffeebean.pk/store-locator/",
    "subtitle": "Johar Town, Lahore",
    "coordinateStatus": "approximate"
  },
  "alhamra": {
    "name": "Alhamra Cultural Complex",
    "parent": "gulberg",
    "type": "place",
    "center": [
      74.332,
      31.51
    ],
    "zoom": 16.8,
    "category": "Culture",
    "address": "Gaddafi Stadium, Ferozepur Road",
    "source": "https://lac.punjab.gov.pk/contact_us",
    "subtitle": "Gaddafi Stadium, Ferozepur Road",
    "coordinateStatus": "approximate"
  },
  "alhamra-mall": {
    "name": "Alhamra Arts Council",
    "parent": "mall-road",
    "type": "place",
    "center": [
      74.3302,
      31.5596
    ],
    "zoom": 16.8,
    "category": "Culture",
    "address": "68 Mall Road",
    "source": "https://lac.punjab.gov.pk/contact_us",
    "subtitle": "68 Mall Road",
    "coordinateStatus": "approximate"
  },
  "model-park": {
    "name": "Model Town Park",
    "parent": "model-town",
    "type": "place",
    "center": [
      74.329,
      31.4845
    ],
    "zoom": 15.8,
    "category": "Parks",
    "address": "Model Town, Lahore",
    "source": "https://epd.punjab.gov.pk/system/files/2025%2024.pdf",
    "subtitle": "Model Town, Lahore",
    "coordinateStatus": "approximate"
  },
  "amanah": {
    "name": "Amanah Mall",
    "parent": "model-town",
    "type": "place",
    "center": [
      74.318,
      31.475
    ],
    "zoom": 16.8,
    "category": "Shopping",
    "address": "Model Town Link Road",
    "source": "https://amanahmall.com.pk/",
    "subtitle": "Model Town Link Road",
    "coordinateStatus": "approximate"
  },
  "j-club": {
    "name": "Defence Club · J Sector",
    "parent": "phase1",
    "type": "place",
    "center": [
      74.385,
      31.491
    ],
    "zoom": 16.8,
    "category": "Sports",
    "address": "J Sector, DHA Phase 1",
    "source": "https://dhalahore.org/clubs/",
    "subtitle": "J Sector, DHA Phase 1",
    "coordinateStatus": "approximate"
  },
  "r-club": {
    "name": "Defence Club · R Sector",
    "parent": "phase2",
    "type": "place",
    "center": [
      74.399,
      31.489
    ],
    "zoom": 16.8,
    "category": "Sports",
    "address": "R Sector, DHA Phase 2",
    "source": "https://dhalahore.org/clubs/",
    "subtitle": "R Sector, DHA Phase 2",
    "coordinateStatus": "approximate"
  },
  "ff-club": {
    "name": "Defence Club · FF Sector",
    "parent": "phase4",
    "type": "place",
    "center": [
      74.416,
      31.474
    ],
    "zoom": 16.8,
    "category": "Sports",
    "address": "FF Sector, DHA Phase 4",
    "source": "https://dhalahore.org/clubs/",
    "subtitle": "FF Sector, DHA Phase 4",
    "coordinateStatus": "approximate"
  },
  "y-pool": {
    "name": "DHA Y Block Swimming Pool",
    "parent": "phase3",
    "type": "place",
    "center": [
      74.4,
      31.477
    ],
    "zoom": 16.8,
    "category": "Sports",
    "address": "Y Block, DHA Phase 3",
    "source": "https://dhalahore.org/beat-the-summer-heat-with-dha-lahore/",
    "subtitle": "Y Block, DHA Phase 3",
    "coordinateStatus": "approximate"
  },
  "packages": {
    "name": "Packages Mall",
    "parent": "walton",
    "type": "place",
    "center": [
      74.355,
      31.471
    ],
    "zoom": 16.8,
    "category": "Shopping",
    "address": "Walton Road",
    "source": "https://www.packagesmall.com/",
    "subtitle": "Walton Road",
    "coordinateStatus": "approximate"
  },
  "emporium": {
    "name": "Emporium Mall",
    "parent": "johar-town",
    "type": "place",
    "center": [
      74.264,
      31.468
    ],
    "zoom": 16.8,
    "category": "Shopping",
    "address": "Abdul Haque Road, Johar Town",
    "source": "https://visitlahore.com/shopping-malls/emporium-mall/",
    "subtitle": "Abdul Haque Road, Johar Town",
    "coordinateStatus": "approximate"
  },
  "bagh-jinnah": {
    "name": "Bagh-e-Jinnah",
    "parent": "mall-road",
    "type": "place",
    "center": [
      74.326,
      31.552
    ],
    "zoom": 15.8,
    "category": "Parks",
    "address": "Mall Road",
    "source": "https://visitlahore.com/attractions/lawrence-garden/",
    "subtitle": "Mall Road",
    "coordinateStatus": "approximate"
  },
  "jilani": {
    "name": "Jilani Park",
    "parent": "jail-road",
    "type": "place",
    "center": [
      74.336,
      31.541
    ],
    "zoom": 15.8,
    "category": "Parks",
    "address": "Jail Road",
    "source": "https://epd.punjab.gov.pk/system/files/2025%2024.pdf",
    "subtitle": "Jail Road",
    "coordinateStatus": "approximate"
  },
  "greater-iqbal": {
    "name": "Greater Iqbal Park",
    "parent": "walled-city",
    "type": "place",
    "center": [
      74.309,
      31.592
    ],
    "zoom": 15.8,
    "category": "Parks",
    "address": "Minar-e-Pakistan area",
    "source": "https://lahoredivision.punjab.gov.pk/projects-lahore",
    "subtitle": "Minar-e-Pakistan area",
    "coordinateStatus": "approximate"
  },
  "lahore-fort": {
    "name": "Lahore Fort",
    "parent": "walled-city",
    "type": "place",
    "center": [
      74.315,
      31.589
    ],
    "zoom": 16.8,
    "category": "Heritage",
    "address": "Northern Walled City",
    "source": "https://walledcitylahore.gop.pk/monuments/",
    "subtitle": "Northern Walled City",
    "coordinateStatus": "approximate"
  },
  "gaddafi": {
    "name": "Gaddafi Stadium",
    "parent": "gulberg",
    "type": "place",
    "center": [
      74.333,
      31.513
    ],
    "zoom": 16.8,
    "category": "Sports",
    "address": "Gulberg, Lahore",
    "source": "https://www.pcb.com.pk/press-release-detail/pcb-opens-gaddafi-stadium-for-india-clash.html",
    "subtitle": "Gulberg, Lahore",
    "coordinateStatus": "approximate"
  },
  "punjab-university": {
    "name": "Punjab University · New Campus",
    "parent": "new-campus",
    "type": "place",
    "center": [
      74.306,
      31.498
    ],
    "zoom": 15.8,
    "category": "Campuses",
    "address": "Quaid-e-Azam Campus, Lahore",
    "source": "https://www.pu.edu.pk/page/show/contact-us.html",
    "subtitle": "Quaid-e-Azam Campus, Lahore",
    "coordinateStatus": "approximate"
  },
  "doongi": {
    "name": "Doongi Ground",
    "parent": "samanabad",
    "type": "place",
    "center": [
      74.299,
      31.524
    ],
    "zoom": 15.8,
    "category": "Parks",
    "address": "Samanabad, Lahore",
    "source": "https://afforestationlahore.com/registered-sites/",
    "subtitle": "Samanabad, Lahore",
    "coordinateStatus": "approximate"
  },
  "expo": {
    "name": "Expo Centre Lahore",
    "parent": "johar-town",
    "type": "place",
    "center": [
      74.258,
      31.463
    ],
    "zoom": 16.8,
    "category": "Exhibitions",
    "address": "Johar Town, Lahore",
    "source": "https://www.pakexcel.com/index.php/node/1402",
    "subtitle": "Johar Town, Lahore",
    "coordinateStatus": "approximate"
  },
  "alliance": {
    "name": "Alliance Française Lahore",
    "parent": "jail-road",
    "type": "place",
    "center": [
      74.356,
      31.55
    ],
    "zoom": 16.8,
    "category": "Culture",
    "address": "155 Scotch Corner, Street 3, Upper Mall Scheme",
    "source": "https://aflahore.org/contact/",
    "subtitle": "155 Scotch Corner, Street 3, Upper Mall Scheme",
    "coordinateStatus": "approximate"
  },
  "fccu": {
    "name": "Forman Christian College",
    "parent": "gulberg",
    "type": "place",
    "center": [
      74.334,
      31.521
    ],
    "zoom": 15.8,
    "category": "Campuses",
    "address": "FCCU, Lahore",
    "source": "https://aflahore.org/whats-on/",
    "subtitle": "FCCU, Lahore",
    "coordinateStatus": "approximate"
  },
  "qasar": {
    "name": "Qasar-e-Noor · Model Town",
    "parent": "model-town",
    "type": "place",
    "center": [
      74.32,
      31.486
    ],
    "zoom": 16.8,
    "category": "Gatherings",
    "address": "Block B, Model Town",
    "source": "https://ensemblepakistan.com/festive-souk-registration/",
    "subtitle": "Block B, Model Town",
    "coordinateStatus": "approximate"
  },
  "falettis": {
    "name": "Faletti’s Hotel",
    "parent": "mall-road",
    "type": "place",
    "center": [
      74.329,
      31.563
    ],
    "zoom": 16.8,
    "category": "Gatherings",
    "address": "Lahore",
    "source": "https://www.sotevents.com/",
    "subtitle": "Lahore",
    "coordinateStatus": "approximate"
  }
};
let currentID='lahore';
let entries=[];
let scene;
let map;
let mapReady=false;
let activeIndex=-1;
let marker;
let districtEventMarkers=[];
let displayedDistrictID=null;
let frame;
let toastTimer;
let exploring=false;
let carouselFrame;
let layoutObserver;
let detailsState=null;
const eventsByPlace=new Map();
const selectedEvents=new Map();
const eventProgress=new Map();
const campusGrounds=[];
const savedScroll=new Map();
const story=document.getElementById('story');
const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
const element=id=>document.getElementById(id);

function feature(geometry,properties={}) { return {type:'Feature',geometry,properties}; }
function collection(features) { return {type:'FeatureCollection',features}; }
function ancestry(id) {
  const chain=[];
  while(id) { chain.unshift(id); id=locations[id].parent; }
  return chain;
}
function notify(message) {
  clearTimeout(toastTimer);element('toast').textContent=message;element('toast').hidden=false;
  toastTimer=setTimeout(()=>element('toast').hidden=true,3500);
}
function isBottomPlace(id) {
  return locations[id].type==='place';
}
function feedEntries(id) {
  const parent=isBottomPlace(id)?locations[locations[id].parent]:locations[id];
  return (parent.children||[]).map(childID=>({id:childID,...locations[childID]}));
}
function eventsFor(place) { return eventsByPlace.get(place.id)||[]; }
function districtExtent(id) {
  const district=locations[id];
  const points=[];
  for(const childID of district.children||[]) {
    const events=eventsFor({id:childID,...locations[childID]});
    if(events.length)points.push(...events.map(event=>event.center));
    else points.push(locations[childID].center);
  }
  if(!points.length)points.push(district.center);
  const longitudes=points.map(point=>point[0]);
  const latitudes=points.map(point=>point[1]);
  const west=Math.min(...longitudes),east=Math.max(...longitudes);
  const south=Math.min(...latitudes),north=Math.max(...latitudes);
  const longitudePadding=Math.max(.004,(east-west)*.24);
  const latitudePadding=Math.max(.003,(north-south)*.24);
  return [west-longitudePadding,south-latitudePadding,east+longitudePadding,north+latitudePadding];
}
function districtBoundary(id) {
  const [west,south,east,north]=districtExtent(id);
  return feature({type:'Polygon',coordinates:[[[west,south],[east,south],[east,north],[west,north],[west,south]]]},{id,name:locations[id].name,accuracy:'illustrative'});
}
function buildSampleEvents() {
  const extraCounts={lums:5,cbtl:2,'phase5-cafe':2,'cbtl-johar':2,alhamra:3,'model-park':3,'alhamra-mall':2,expo:2,jilani:2};
  const titles={
    'Cafés':['Coffee & a conversation','Bring a book, stay for chai'],
    'Parks':['A sunset walk','An easy neighbourhood run','Sketching under the trees'],
    'Sports':['A friendly doubles match','After-work badminton'],
    'Culture':['An evening of live music','Art & conversation','A small theatre circle'],
    'Shopping':['Meet for a movie','Dinner after the film'],
    'Heritage':['A photography walk','Stories from old Lahore'],
    'Exhibitions':['Explore the exhibition together','Design & ideas meetup'],
    'Gatherings':['An evening over chai','Meet the neighbourhood'],
    'Campuses':['Campus reading circle','A conversation after class'],
  };
  for(const [id,place] of Object.entries(locations)) {
    if(!isBottomPlace(id)||id==='lums')continue;
    const names=titles[place.category]||titles.Gatherings;
    eventsByPlace.set(id,Array.from({length:extraCounts[id]||1},(_,i)=>({
      name:names[i%names.length],locationName:place.name,center:place.center,zoom:place.zoom,
      count:2+(i+Object.keys(locations).indexOf(id))%7,time:['5:30 PM','6:30 PM','8:00 PM'][i%3],
      game:place.category==='Sports',subtitle:'Sample event · Not a real booking',sample:true,
    })));
  }
  const sports=['football','cricket','tennis','football','basketball'];
  const names=['An evening five-a-side','Tape-ball before dinner','Doubles after class','One more under the lights','Half-court under the lights'];
  eventsByPlace.set('lums',sports.map((sport,i)=>{
    const ground=campusGrounds.find(item=>item.sport===sport)||campusGrounds[0];
    return {name:names[i],groundID:ground.id,locationName:ground.name,center:ground.center,zoom:17.2,
      count:[4,3,2,2,3][i],time:['5:30 PM','6:00 PM','6:30 PM','7:30 PM','8:00 PM'][i],
      game:true,subtitle:`${sport[0].toUpperCase()+sport.slice(1)} · Sample event`,sample:true};
  }));
  function countEvents(id) {
    const place=locations[id];
    place.count=isBottomPlace(id)?eventsFor({id,...place}).length:place.children.reduce((sum,child)=>sum+countEvents(child),0);
    return place.count;
  }
  countEvents('lahore');
  if(locations.lahore.count!==40)throw Error('Expected 40 sample events');
}
function focusedGeometry(entry) {
  if(!entry||!isBottomPlace(entry.id))return entry;
  const events=eventsFor(entry);
  const progress=eventProgress.get(entry.id)||0;
  const first=Math.min(events.length-1,Math.floor(progress));
  const next=Math.min(events.length-1,first+1);
  const amount=reduceMotion?(progress-first>.5?1:0):progress-first;
  const event=events[selectedEvents.get(entry.id)||0];
  return {...event,id:entry.id,type:'activity',placeID:entry.id,name:entry.name,
    center:[events[first].center[0]+(events[next].center[0]-events[first].center[0])*amount,events[first].center[1]+(events[next].center[1]-events[first].center[1])*amount],
    zoom:events[first].zoom+(events[next].zoom-events[first].zoom)*amount};
}
function renderCrumbs(id) {
  element('breadcrumbs').replaceChildren();
  ancestry(id).forEach((ancestor,index)=>{
    if(index){const divider=document.createElement('span');divider.textContent='›';element('breadcrumbs').append(divider);}
    const button=document.createElement('button');button.textContent=locations[ancestor].name;button.onclick=()=>navigate(ancestor);
    if(ancestor===id)button.setAttribute('aria-current','location');element('breadcrumbs').append(button);
  });
}
function addEventCarousel(card,place) {
  const events=eventsFor(place);
  card.classList.add('place-events');
  card.innerHTML='<div class="place-heading"><span></span><a class="venue-source" target="_blank" rel="noopener noreferrer">Venue source ↗</a><button class="open-place">Open place ↗</button></div><div class="event-carousel" tabindex="0" role="region" aria-roledescription="carousel"></div><div class="event-navigation"><button class="event-prev" aria-label="Previous event">←</button><div class="event-dots"></div><span class="event-status" aria-live="polite"></span><button class="event-next" aria-label="Next event">→</button></div>';
  card.querySelector('.place-heading span').textContent=place.name;
  card.querySelector('.venue-source').href=place.source;
  card.querySelector('.open-place').hidden=isBottomPlace(currentID);
  card.querySelector('.open-place').onclick=()=>navigate(place.id);
  const carousel=card.querySelector('.event-carousel');
  carousel.setAttribute('aria-label',`Events at ${place.name}`);
  events.forEach((event,index)=>{
    const panel=document.createElement('section');panel.className='event-panel';panel.setAttribute('role','group');panel.setAttribute('aria-roledescription','slide');panel.setAttribute('aria-label',`${index+1} of ${events.length}`);
    panel.innerHTML='<div class="card-top"><span class="tag"></span><span class="event-time"></span></div><h2></h2><p class="event-location"></p><div class="card-stat"><strong></strong><div><b></b><small></small></div><div class="avatars"><span>HR</span><span>SA</span><span>AK</span></div></div><button class="primary"><span></span><span>↗</span></button>';
    panel.querySelector('.tag').textContent=event.game?'Sample game':'Sample gathering';
    panel.querySelector('.event-time').textContent=`Today · ${event.time}`;
    panel.querySelector('h2').textContent=event.name;
    panel.querySelector('.event-location').textContent=`⌖ ${event.locationName} · ${place.name===event.locationName?'Lahore':place.name}`;
    panel.querySelector('.card-stat strong').textContent=event.count;
    panel.querySelector('.card-stat b').textContent=event.game?'spots left':'seats left';
    panel.querySelector('.card-stat small').textContent=event.subtitle;
    panel.querySelector('.primary span').textContent=event.game?'View game':'View gathering';
    panel.querySelector('.primary').onclick=()=>openEventDetails(place,event);
    carousel.append(panel);
    const dot=document.createElement('button');dot.setAttribute('aria-label',`Show event ${index+1}`);dot.onclick=()=>moveEvent(index);card.querySelector('.event-dots').append(dot);
  });
  function moveEvent(index) {
    const next=Math.max(0,Math.min(index,events.length-1));
    carousel.scrollTo({left:carousel.children[next].offsetLeft-carousel.children[0].offsetLeft,behavior:reduceMotion?'instant':'smooth'});
  }
  function updateEvent() {
    if(!carousel.isConnected||!carousel.clientWidth||element('event-details').open)return;
    const progress=Math.max(0,Math.min(events.length-1,carousel.scrollLeft/(carousel.children.length>1?carousel.children[1].offsetLeft-carousel.children[0].offsetLeft:carousel.clientWidth)));
    eventProgress.set(place.id,progress);
    const index=Math.round(progress);
    const changed=selectedEvents.get(place.id)!==index;
    selectedEvents.set(place.id,index);
    card.querySelector('.event-status').textContent=`Event ${index+1} of ${events.length}`;
    card.querySelector('.event-prev').disabled=index===0;
    card.querySelector('.event-next').disabled=index===events.length-1;
    [...card.querySelector('.event-dots').children].forEach((dot,i)=>dot.setAttribute('aria-current',i===index?'true':'false'));
    [...carousel.children].forEach((panel,i)=>panel.inert=i!==index);
    if(entries[activeIndex]?.id===place.id){if(changed)focusEntry(activeIndex);queueStory();}
  }
  card.querySelector('.event-prev').onclick=()=>moveEvent((selectedEvents.get(place.id)||0)-1);
  card.querySelector('.event-next').onclick=()=>moveEvent((selectedEvents.get(place.id)||0)+1);
  carousel.addEventListener('scroll',()=>{cancelAnimationFrame(carouselFrame);carouselFrame=requestAnimationFrame(updateEvent);},{passive:true});
  carousel.addEventListener('keydown',event=>{
    if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();event.stopPropagation();moveEvent((selectedEvents.get(place.id)||0)+(event.key==='ArrowRight'?1:-1));}
  });
  // Restore the selected event once the new card has been attached and laid out.
  return ()=>{const panel=carousel.children[selectedEvents.get(place.id)||0];carousel.scrollLeft=panel.offsetLeft-carousel.children[0].offsetLeft;updateEvent();};
}
function cameraFor(place,index=-1) {
  const campus=place.id==='lums'||place.placeID==='lums';
  let center=place.center;
  let zoom=place.type==='city'?11.3:place.id==='lums'&&place.type!=='activity'?15.8:place.type==='activity'?Math.min(place.zoom,17.4):place.zoom;
  if(place.type==='district') {
    const [west,south,east,north]=districtExtent(place.id);
    center=[(west+east)/2,(south+north)/2];
    const span=Math.max(east-west,(north-south)*1.55);
    zoom=Math.min(place.zoom,Math.log2(360/span)-.7);
  }
  if(place.id==='lums'&&place.type!=='activity'&&scene) {
    const box=scene.area.bbox;center=[(box[0]+box[2])/2,(box[1]+box[3])/2];
  }
  if(innerWidth<=700)zoom-=place.type==='district'?.1:.55;
  return {center,zoom,pitch:place.type==='city'?0:campus?52:place.type==='place'||place.type==='activity'?48:35,bearing:campus?-23:index<0?0:index%2?10:-9};
}
function navigate(id,updateHash=true) {
  if(!locations[id])id='lahore';
  clearTimeout(wheelEnd);
  wheelSwipe=null;
  touchSwipe=null;
  mouseSwipe=null;
  cancelAnimationFrame(frame);
  cancelAnimationFrame(carouselFrame);
  story.style.scrollSnapType='none';
  story.style.overflowY='hidden';
  story.scrollTo({top:story.scrollTop,behavior:'instant'});
  if(element('event-details').open){detailsState=null;element('event-details').close();}
  const previousID=currentID;
  savedScroll.set(currentID,story.scrollTop);
  currentID=id;activeIndex=-2;entries=feedEntries(id);
  setExplore(false);
  if(updateHash&&location.hash!==`#${id}`)history.pushState(null,'',`#${id}`);
  renderFeed();
  const enteringChild=locations[id].parent===previousID;
  const targetScroll=isBottomPlace(id)?entries.findIndex(entry=>entry.id===id)*story.clientHeight:enteringChild?0:(savedScroll.get(id)||0);
  story.scrollTop=targetScroll;
  story.style.scrollSnapType='';
  requestAnimationFrame(()=>{
    if(currentID!==id)return;
    story.style.overflowY='auto';
    story.scrollTo({top:targetScroll,behavior:'instant'});
    drawStory();
  });
  if(mapReady){map.stop();updateCampusLayers();}
  drawStory();
}
function renderFeed() {
  const parent=locations[currentID];
  const initialiseCarousels=[];
  renderCrumbs(currentID);
  story.replaceChildren();
  const hero=document.createElement('section');hero.className='chapter hero';
  hero.innerHTML='<div class="hero-content"><div class="eyebrow"></div><div class="hero-kicker"></div><h1></h1><p></p><div class="hero-hint"><b>↓</b> Scroll to move through the map</div></div>';
  hero.querySelector('.eyebrow').textContent=currentID==='lahore'?'ONE CITY. YOUR PEOPLE.':`LAHORE / ${parent.type==='district'?'DISTRICT':'PLACE'}`;
  hero.querySelector('.hero-kicker').textContent='Explore';
  hero.querySelector('h1').textContent=parent.name.toUpperCase();
  if(parent.name.length>15)hero.querySelector('h1').style.fontSize='clamp(55px,9vw,125px)';
  const dot=document.createElement('span');dot.textContent='.';hero.querySelector('h1').append(dot);
  hero.querySelector('p').textContent=parent.description||'Scroll to see what’s happening here. One place, one moment at a time.';
  if(parent.type==='district'&&parent.children.length) {
    const firstPlace=locations[parent.children[0]];
    const firstEvent=eventsFor({id:parent.children[0],...firstPlace})[0];
    const portal=document.createElement('aside');
    portal.className='district-portal';
    portal.innerHTML='<div><span class="portal-kicker"></span><strong></strong><small></small></div><button class="portal-action"><span></span><b>↗</b></button>';
    portal.querySelector('.portal-kicker').textContent=`TONIGHT INSIDE ${parent.name.toUpperCase()}`;
    portal.querySelector('strong').textContent=`${parent.children.length} ${parent.children.length===1?'place':'places'} · ${parent.count||0} things happening`;
    portal.querySelector('small').textContent=firstEvent?`First up · ${firstPlace.name} · ${firstEvent.time}`:`Start with ${firstPlace.name}`;
    portal.querySelector('.portal-action span').textContent='See places';
    portal.querySelector('.portal-action').onclick=()=>navigate(parent.children[0]);
    hero.querySelector('.hero-hint').remove();
    hero.querySelector('.hero-content').append(portal);
  } else if(parent.type==='city'&&parent.children.length) {
    const firstDistrict=locations[parent.children[0]];
    const firstPlace=locations[firstDistrict.children[0]];
    const portal=document.createElement('aside');
    portal.className='district-portal city-portal';
    portal.innerHTML='<div><span class="portal-kicker"></span><strong></strong><small></small></div><button class="portal-action"><span></span><b>↓</b></button>';
    portal.querySelector('.portal-kicker').textContent='TONIGHT INSIDE LAHORE';
    portal.querySelector('strong').textContent=`${parent.children.length} districts · ${parent.count||0} things happening`;
    portal.querySelector('small').textContent=`Start with ${firstDistrict.name} · ${firstPlace.name}`;
    portal.querySelector('.portal-action span').textContent='Explore districts';
    portal.querySelector('.portal-action').onclick=()=>scrollToChapter(1);
    hero.querySelector('.hero-hint').remove();
    hero.querySelector('.hero-content').append(portal);
  }
  if(!isBottomPlace(currentID))story.append(hero);
  entries.forEach((entry,index)=>{
    const section=document.createElement('section');section.className='chapter';section.dataset.id=entry.id;
    const card=document.createElement('article');card.className='story-card';card.dataset.location=entry.id;
    if(isBottomPlace(entry.id)) {
      initialiseCarousels.push(addEventCarousel(card,entry));
    } else {
      const firstPlace=locations[entry.children[0]];
      const firstEvent=eventsFor({id:entry.children[0],...firstPlace})[0];
      card.classList.add('district-card');
      card.innerHTML='<div class="card-top"><span class="tag"></span><span class="ordinal"></span></div><h2></h2><div class="district-card-preview"><span>TONIGHT INSIDE</span><strong></strong><small></small></div><div class="card-stat"><strong></strong><div><b></b><small></small></div><div class="avatars"><span>HR</span><span>SA</span><span>AK</span></div></div><p class="card-caption"></p><div class="card-actions"><button class="primary"><span></span><span>↗</span></button><button class="secondary">Next ↓</button></div>';
      card.querySelector('.tag').textContent='Lahore district';
      card.querySelector('.ordinal').textContent=`${String(index+1).padStart(2,'0')} / ${String(entries.length).padStart(2,'0')}`;
      card.querySelector('h2').textContent=entry.name;
      card.querySelector('.district-card-preview strong').textContent=firstPlace.name;
      card.querySelector('.district-card-preview small').textContent=firstEvent?`${firstEvent.name} · ${firstEvent.time}`:`${entry.children.length} ${entry.children.length===1?'place':'places'} to explore`;
      card.querySelector('.card-stat strong').textContent=entry.count||1;
      card.querySelector('.card-stat b').textContent=entry.count===1?'thing happening':'things happening';
      card.querySelector('.card-stat small').textContent=`Across ${entry.children.length} ${entry.children.length===1?'place':'places'} tonight`;
      card.querySelector('.card-caption').textContent=`Start with ${firstPlace.name}, or open ${entry.name} to see every place.`;
      card.querySelector('.primary span').textContent=`See places in ${entry.name}`;
      card.querySelector('.primary').onclick=()=>navigate(entry.id);
      card.querySelector('.secondary').onclick=()=>scrollToChapter(index+2);
    }
    section.append(card);story.append(section);
  });
  const end=document.createElement('section');end.className='chapter end-chapter';
  end.innerHTML='<article class="story-card"><div class="card-top">A LITTLE FURTHER?</div><h2>That’s this chapter.</h2><p class="card-caption">Scroll back to find your place, or pull out to explore the next part of Lahore.</p><div class="card-actions"><button class="primary"><span>Back to the beginning</span><span>↑</span></button><button class="secondary">Back to parent</button></div></article>';
  end.querySelector('.primary').onclick=()=>scrollToChapter(0);
  end.querySelector('.secondary').onclick=goUp;
  if(!isBottomPlace(currentID))story.append(end);
  element('dots').innerHTML=entries.map(()=>'<i></i>').join('');
  element('depth').innerHTML=ancestry(currentID).map(()=>'<i></i>').join('');element('depth').lastElementChild.classList.add('active');
  element('zoom-out').disabled=!parent.parent;
  element('level-label').textContent=parent.type==='city'?'DISTRICTS':parent.type==='district'?'PLACES':'PLACE';
  for(const initialise of initialiseCarousels)initialise();
  if(layoutObserver){
    layoutObserver.disconnect();
    for(const node of [story,document.querySelector('header'),element('breadcrumbs'),document.querySelector('.level-controls'),...story.querySelectorAll('.story-card')])layoutObserver.observe(node);
  }
}
function scrollToChapter(index) {
  const sections=story.querySelectorAll('.chapter');
  story.scrollTo({top:sections[Math.max(0,Math.min(index,sections.length-1))].offsetTop,behavior:reduceMotion?'instant':'smooth'});
}
function goUp() {const parent=locations[currentID].parent;if(parent)navigate(parent);else notify('Lahore is the current city. More cities will come later.');}
function enterFocused() {if(isBottomPlace(currentID))return;const entry=entries[activeIndex<0?0:activeIndex];if(entry)navigate(entry.id);}
function updateCampusLayers() {
  const focus=entries[activeIndex];
  const atCampus=focus?.id==='lums'||(activeIndex<0&&currentID==='lums');
  for(const layer of ['campus-buildings','campus-paths','grounds-fill','grounds-outline','ground-markings'])map.setLayoutProperty(layer,'visibility',atCampus?'visible':'none');
  map.setPaintProperty('grounds-fill','fill-color',['case',['==',['get','id'],focus?.id==='lums'?(eventsFor(focus)[selectedEvents.get(focus.id)||0].groundID||''):''],'#56834d','#779767']);
}
function updateDistrictMap(entry) {
  for(const eventMarker of districtEventMarkers)eventMarker.remove();
  districtEventMarkers=[];
  const districtID=entry?.type==='district'?entry.id:locations[currentID].type==='district'?currentID:null;
  const source=map.getSource('district-boundary');
  if(!districtID) {
    displayedDistrictID=null;
    source.setData(collection([]));
    for(const layer of ['district-boundary-fill','district-boundary-outline'])map.setLayoutProperty(layer,'visibility','none');
    return;
  }
  displayedDistrictID=districtID;
  source.setData(collection([districtBoundary(districtID)]));
  for(const layer of ['district-boundary-fill','district-boundary-outline'])map.setLayoutProperty(layer,'visibility','visible');

  const eventGroups=new Map();
  for(const childID of locations[districtID].children) {
    const place=locations[childID];
    for(const event of eventsFor({id:childID,...place})) {
      const key=`${event.center[0].toFixed(5)},${event.center[1].toFixed(5)}`;
      const group=eventGroups.get(key)||{center:event.center,count:0,name:event.locationName||place.name};
      group.count++;
      eventGroups.set(key,group);
    }
  }
  for(const group of eventGroups.values()) {
    const bubble=document.createElement('div');
    bubble.className='event-map-bubble';
    bubble.innerHTML='<div class="event-map-bubble-content"><strong></strong><span></span><small></small></div>';
    bubble.querySelector('strong').textContent=group.count;
    bubble.querySelector('span').textContent=group.count===1?'event':'events';
    bubble.querySelector('small').textContent=group.name;
    bubble.title=`${group.count} sample ${group.count===1?'event':'events'} at ${group.name}`;
    districtEventMarkers.push(new maplibregl.Marker({element:bubble,anchor:'bottom'}).setLngLat(group.center).addTo(map));
  }
}
function focusEntry(index) {
  activeIndex=index;
  const entry=entries[index];
  const geometry=focusedGeometry(entry);
  if(isBottomPlace(currentID)&&entry)renderCrumbs(entry.id);
  marker?.remove();marker=null;
  const kind=locations[currentID].type==='city'?'District':'Place';
  element('counter').textContent=entry?`${kind} ${index+1} of ${entries.length}`:`${entries.length} ${kind.toLowerCase()}s · Scroll ↓`;
  [...element('dots').children].forEach((dot,i)=>dot.classList.toggle('active',i===index));
  updateLevelControls(entry);
  if(!mapReady)return;

  updateCampusLayers();
  updateDistrictMap(entry);
  updateSkinFocus();
  if(entry){
    const pin=document.createElement('div');pin.className='pin';
    const label=document.createElement('span');label.className='pin-label';label.textContent=geometry.locationName||entry.name;pin.append(label);
    marker=new maplibregl.Marker({element:pin,anchor:'center'}).setLngLat(geometry.center).addTo(map);
  }
}
function updateLevelControls(entry) {
  const bottom=isBottomPlace(currentID);
  const parent=locations[currentID].parent;
  const target=entry||entries[0];
  element('zoom-in').hidden=bottom;
  element('zoom-in').disabled=bottom||!target;
  element('zoom-in').textContent=target?`← Swipe ${target.name}`:'← Swipe open';
  element('zoom-out').hidden=!parent;
  element('zoom-out').textContent=parent?`${locations[parent].name} →`:'Back';
}
function cameraPadding(height,index) {
  // The geographic centre belongs in the clear map space, not behind a card.
  const viewportTop=story.getBoundingClientRect().top;
  const controls=[document.querySelector('header'),element('breadcrumbs'),document.querySelector('.level-controls')];
  const controlBottom=Math.max(...controls.map(node=>node.getBoundingClientRect().bottom-viewportTop));
  const top=Math.min(height-60,Math.max(24,controlBottom+18));
  const card=story.querySelectorAll('.story-card')[index];
  const cardTop=card?card.getBoundingClientRect().top-viewportTop:height-100;
  const clearBottom=Math.max(top+24,Math.min(height-48,cardTop-28));
  return {top:Math.round(top),bottom:Math.round(height-clearBottom),left:0,right:0};
}
function openEventDetails(place,event) {
  const dialog=element('event-details');
  clearTimeout(wheelEnd);wheelSwipe=null;touchSwipe=null;
  cancelAnimationFrame(frame);cancelAnimationFrame(carouselFrame);
  const carousels=[...story.querySelectorAll('.event-carousel')];
  detailsState={focus:document.activeElement,top:story.scrollTop,carousels:carousels.map(node=>({node,left:node.scrollLeft}))};
  story.style.scrollSnapType='';
  story.scrollTo({top:story.scrollTop,behavior:'instant'});
  for(const node of carousels){node.style.scrollSnapType='';node.scrollTo({left:node.scrollLeft,behavior:'instant'});}
  element('details-title').textContent=event.name;
  element('details-location').textContent=event.locationName===place.name?place.name:`${event.locationName} · ${place.name}`;
  element('details-time').textContent=`Today · ${event.time} (sample)`;
  element('details-spots').textContent=`${event.count} ${event.game?'spots':'seats'} left (sample)`;
  history.pushState({eventDetails:true},'',location.href);
  dialog.showModal();
}
function closeEventDetails() {
  if(element('event-details').open)history.back();
}
function drawStory() {
  if(exploring||element('event-details').open)return;
  const height=story.clientHeight;
  const progress=story.scrollTop/height;
  const offset=isBottomPlace(currentID)?0:1;
  const left=Math.min(Math.floor(progress),Math.max(0,entries.length-1+offset));
  const fraction=Math.max(0,Math.min(1,progress-left));
  const eased=fraction*fraction*(3-2*fraction);
  const index=offset&&progress<.48?-1:Math.max(0,Math.min(entries.length-1,Math.round(progress)-offset));
  if(index!==activeIndex)focusEntry(index);
  const hero=story.querySelector('.hero-content');
  if(hero){hero.style.opacity=Math.max(0,1-progress*1.7);hero.style.transform=reduceMotion?'':`translateY(${-progress*70}px)`;}
  story.querySelectorAll('.story-card').forEach((card,i)=>{
    const distance=i+offset-progress;
    card.style.opacity=String(Math.max(0,1-Math.abs(distance)*1.35));
    card.style.transform=reduceMotion?'':`perspective(1000px) translateY(${Math.max(0,distance)*24}px) rotateX(${Math.max(-10,Math.min(25,distance*22))}deg) scale(${1-Math.min(.1,Math.abs(distance)*.07)})`;
    card.inert=Math.abs(distance)>.6;
  });
  if(!mapReady)return;
  if(marker&&entries[activeIndex])marker.setLngLat(focusedGeometry(entries[activeIndex]).center);
  const overview={id:currentID,...locations[currentID]};
  const fromEntry=offset&&left===0?overview:focusedGeometry(entries[Math.min(entries.length-1,left-offset)]);
  const toEntry=focusedGeometry(entries[Math.min(left+1-offset,entries.length-1)]);
  const from=cameraFor(fromEntry,left-offset);
  const to=cameraFor(toEntry,left+1-offset);
  const amount=reduceMotion?(fraction>.5?1:0):eased;
  if(currentID==='lahore'&&map.getSource('district-boundary')) {
    const fromDistrict=fromEntry?.type==='district'?fromEntry.id:toEntry?.id;
    const toDistrict=toEntry?.type==='district'?toEntry.id:fromDistrict;
    if(fromDistrict) {
      const changingDistrict=fromDistrict!==toDistrict;
      const visibleDistrict=changingDistrict&&amount>=.5?toDistrict:fromDistrict;
      if(displayedDistrictID!==visibleDistrict)updateDistrictMap({id:visibleDistrict,type:'district'});
      const boundaryOpacity=fromEntry?.type==='city'?amount:changingDistrict?(amount<.5?1-amount*2:(amount-.5)*2):1;
      map.setPaintProperty('district-boundary-fill','fill-opacity',.13*boundaryOpacity);
      map.setPaintProperty('district-boundary-outline','line-opacity',boundaryOpacity);
      for(const eventMarker of districtEventMarkers) {
        const bubble=eventMarker.getElement().querySelector('.event-map-bubble-content');
        bubble.style.opacity=String(boundaryOpacity);
        bubble.style.scale=String(.82+.18*boundaryOpacity);
      }
    }
  }
  // Scroll is the clock: no flyTo animation competes with a user's next swipe.
  map.jumpTo({center:[from.center[0]+(to.center[0]-from.center[0])*amount,from.center[1]+(to.center[1]-from.center[1])*amount],zoom:from.zoom+(to.zoom-from.zoom)*amount,pitch:from.pitch+(to.pitch-from.pitch)*amount,bearing:from.bearing+(to.bearing-from.bearing)*amount,padding:cameraPadding(height,activeIndex)});
}
function queueStory() {cancelAnimationFrame(frame);frame=requestAnimationFrame(drawStory);}
function setExplore(on) {
  exploring=on;document.body.classList.toggle('exploring',on);
  element('explore').querySelector('span').textContent=on?'Back to stories':'Explore map';
  if(!on)queueStory();
}
async function start() {
  try {
    const campusResponse=await fetch('lums-scene.json');
    if(!campusResponse.ok)throw Error('Local place data unavailable');
    scene=await campusResponse.json();
    for(const place of scene.places.features)campusGrounds.push({id:`ground-${place.properties.id}`,name:place.properties.name,center:place.geometry.coordinates,sport:place.properties.render_style});
    buildSampleEvents();
    navigate(location.hash.slice(1)||'lahore',false);
    element('loading').hidden=true;
    window.prototypeReady=true;
    // Local hierarchy and fixtures are ready before the optional external basemap.
    if(!window.maplibregl)throw Error('Map library unavailable');
    const styleResponse=await fetch('https://tiles.openfreemap.org/styles/liberty');
    if(!styleResponse.ok)throw Error('Map style unavailable');
    const style=await styleResponse.json();
    map=new maplibregl.Map({container:'map',style,center:locations.lahore.center,zoom:10.7,attributionControl:true,maxZoom:19,minZoom:9,canvasContextAttributes:{antialias:true}});
    map.addControl(new maplibregl.ScaleControl({maxWidth:90}),'bottom-right');
    map.on('error',event=>{console.warn('Map resource:',event.error?.message);});
    // Prepare the feed when the style is ready; tile downloads must not block navigation.
    const initialiseMap=()=>{
      map.addSource('campus-buildings',{type:'geojson',data:collection(scene.buildings.map(building=>feature(building.geometry,{height:building.height_metres*1.65})))});
      map.addLayer({id:'campus-buildings',type:'fill-extrusion',source:'campus-buildings',paint:{'fill-extrusion-height':['get','height'],'fill-extrusion-color':'#d9c7a3','fill-extrusion-base':0,'fill-extrusion-opacity':1}});
      map.addSource('campus-paths',{type:'geojson',data:collection(scene.paths.map(path=>feature(path.geometry)))});
      map.addLayer({id:'campus-paths',type:'line',source:'campus-paths',paint:{'line-color':'#f5edda','line-width':3}});
      const groundFeatures=[];const markings=[];
      for(const place of scene.places.features) {
        const id=`ground-${place.properties.id}`;
        const geometry=place.geometry;
        // API places use a point geometry and a separate footprint property.
        const boundary=place.properties.boundary;
        const position=geometry.type==='Point'?geometry.coordinates:locations.lums.center;
        const sport=place.properties.render_style;

        if(boundary)groundFeatures.push(feature(boundary,{id}));
        if(boundary && sport==='cricket') {
          const [lng,lat]=position;
          const dLat=9/111320,dLng=1.5/(111320*Math.cos(lat*Math.PI/180));
          markings.push(feature({type:'LineString',coordinates:[[lng-dLng,lat-dLat],[lng+dLng,lat-dLat],[lng+dLng,lat+dLat],[lng-dLng,lat+dLat],[lng-dLng,lat-dLat]]}));
          const circle=Array.from({length:65},(_,index)=>{const angle=index/64*Math.PI*2;return[lng+Math.cos(angle)*28/(111320*Math.cos(lat*Math.PI/180)),lat+Math.sin(angle)*28/111320];});
          markings.push(feature({type:'LineString',coordinates:circle}));
        }
        if(boundary && sport==='football') {
          const ring=boundary.type==='Polygon'?boundary.coordinates[0]:boundary.coordinates[0][0];
          const lngs=ring.map(p=>p[0]),lats=ring.map(p=>p[1]);
          const west=Math.min(...lngs),east=Math.max(...lngs),south=Math.min(...lats),north=Math.max(...lats);
          const x=(east-west)*.12,y=(north-south)*.12;
          markings.push(feature({type:'LineString',coordinates:[[west+x,south+y],[east-x,south+y],[east-x,north-y],[west+x,north-y],[west+x,south+y]]}));
          markings.push(feature({type:'LineString',coordinates:[[west+x,(south+north)/2],[east-x,(south+north)/2]]}));
        }
      }
      map.addSource('grounds',{type:'geojson',data:collection(groundFeatures)});
      map.addLayer({id:'grounds-fill',type:'fill',source:'grounds',paint:{'fill-color':'#779767','fill-opacity':.92}});
      map.addLayer({id:'grounds-outline',type:'line',source:'grounds',paint:{'line-color':'#f7f2de','line-width':2}});
      map.addSource('markings',{type:'geojson',data:collection(markings)});
      map.addLayer({id:'ground-markings',type:'line',source:'markings',paint:{'line-color':'#f2eddc','line-width':1.2}});
      map.addSource('district-boundary',{type:'geojson',data:collection([])});
      map.addLayer({id:'district-boundary-fill',type:'fill',source:'district-boundary',paint:{'fill-color':'#d66a42','fill-opacity':.13}});
      map.addLayer({id:'district-boundary-outline',type:'line',source:'district-boundary',paint:{'line-color':'#d14a35','line-width':3.5,'line-opacity':1,'line-dasharray':[2,1.5]}});
      map.on('resize',queueStory);
      applyMapSkin(scene);
      mapReady=true;
      element('loading').hidden=true;
      navigate(location.hash.slice(1)||'lahore',false);
      window.prototypeReady=true;
    };
    if(map.isStyleLoaded())initialiseMap();
    else map.once('style.load',initialiseMap);
  } catch(error) {console.error(error);element('loading').hidden=true;element('map-error').hidden=false;}
}

// A gesture chooses one axis once; drifting diagonally cannot change the other feed.
let touchSwipe=null;
let wheelSwipe=null;
let mouseSwipe=null;
let wheelEnd;
function beginSwipe(x,y,carousel) {
  const stride=carousel&&carousel.children.length>1?carousel.children[1].offsetLeft-carousel.children[0].offsetLeft:carousel?.clientWidth;
  return {x,y,lastX:x,lastY:y,axis:null,carousel,stride,top:story.scrollTop,left:carousel?.scrollLeft||0};
}
function dragSwipe(swipe,x,y) {
  swipe.lastX=x;swipe.lastY=y;
  const dx=x-swipe.x,dy=y-swipe.y;
  if(!swipe.axis&&Math.hypot(dx,dy)<10)return;
  if(!swipe.axis) {
    // On an event row a horizontal swipe moves between events; anywhere else it changes level.
    swipe.axis=Math.abs(dx)>Math.abs(dy)?'x':'y';
    if(swipe.axis==='x'&&swipe.carousel)swipe.carousel.style.scrollSnapType='none';
  }
  if(swipe.axis==='x') {
    if(swipe.carousel)swipe.carousel.scrollLeft=swipe.left-dx;
    else if(!reduceMotion)story.style.transform=`translateX(${dx*.35}px)`;
  }
}
// Right to left opens the focused district or place; left to right goes back a level.
function finishLevelSwipe(swipe,cancelled) {
  story.style.transition='transform .2s ease';
  story.style.transform='';
  setTimeout(()=>{story.style.transition='';},220);
  const moved=swipe.lastX-swipe.x;
  if(cancelled||Math.abs(moved)<60)return;
  if(moved<0)enterFocused();
  else goUp();
}
function finishSwipe(swipe,cancelled=false) {
  if(swipe?.axis!=='x')return;
  if(!swipe.carousel){finishLevelSwipe(swipe,cancelled);return;}
  const scroller=swipe.carousel;
  if(!scroller?.isConnected)return;
  const stride=swipe.stride;
  const origin=swipe.left;
  const delta=swipe.x-swipe.lastX;
  const initial=Math.round(origin/stride);
  const count=scroller.children.length;
  const index=Math.max(0,Math.min(count-1,initial+(!cancelled&&Math.abs(delta)>40?Math.sign(delta):0)));
  scroller.style.scrollSnapType='';
  const position=scroller.children[index].offsetLeft-scroller.children[0].offsetLeft;
  scroller.scrollTo({left:position,behavior:reduceMotion?'instant':'smooth'});
}
story.addEventListener('touchstart',event=>{
  if(event.touches.length!==1){finishSwipe(touchSwipe,true);touchSwipe=null;return;}
  const touch=event.touches[0];
  touchSwipe=beginSwipe(touch.clientX,touch.clientY,event.target.closest('.event-carousel'));
},{passive:true});
story.addEventListener('touchmove',event=>{
  if(!touchSwipe||event.touches.length!==1)return;
  dragSwipe(touchSwipe,event.touches[0].clientX,event.touches[0].clientY);
  if(touchSwipe.axis==='x')event.preventDefault();
},{passive:false});
story.addEventListener('touchend',()=>{finishSwipe(touchSwipe);touchSwipe=null;},{passive:true});
story.addEventListener('touchcancel',()=>{finishSwipe(touchSwipe,true);touchSwipe=null;},{passive:true});
story.addEventListener('wheel',event=>{
  if(event.ctrlKey)return;
  const carousel=event.target.closest('.event-carousel');
  if(Math.abs(event.deltaY)>=Math.abs(event.deltaX)) {
    clearTimeout(wheelEnd);
    wheelSwipe=null;
    return;
  }
  event.preventDefault();
  if(!wheelSwipe)wheelSwipe=beginSwipe(0,0,carousel);
  const factor=event.deltaMode===1?16:event.deltaMode===2?story.clientHeight:1;
  dragSwipe(wheelSwipe,wheelSwipe.lastX-event.deltaX*factor,wheelSwipe.lastY-event.deltaY*factor);
  clearTimeout(wheelEnd);
  wheelEnd=setTimeout(()=>{finishSwipe(wheelSwipe);wheelSwipe=null;},160);
},{passive:false});

story.addEventListener('scroll',queueStory,{passive:true});
// Mouse drags behave like touch swipes, so the level gesture can be tried on desktop.
story.addEventListener('mousedown',event=>{
  if(event.button!==0||event.target.closest('button,a'))return;
  event.preventDefault();
  mouseSwipe=beginSwipe(event.clientX,event.clientY,event.target.closest('.event-carousel'));
});
window.addEventListener('mousemove',event=>{if(mouseSwipe)dragSwipe(mouseSwipe,event.clientX,event.clientY);});
window.addEventListener('mouseup',()=>{finishSwipe(mouseSwipe);mouseSwipe=null;});
element('zoom-in').onclick=enterFocused;
element('zoom-out').onclick=goUp;
element('explore').onclick=()=>setExplore(!exploring);
element('restart').onclick=()=>{setExplore(false);scrollToChapter(0);};
element('city').onclick=()=>notify('Lahore is selected. Other cities will come later.');
window.addEventListener('popstate',()=>{if(element('event-details').open){element('event-details').close();return;}navigate(location.hash.slice(1)||'lahore',false);});
window.addEventListener('hashchange',()=>{const id=location.hash.slice(1);if(id!==currentID)navigate(id,false);});
window.addEventListener('keydown',event=>{
  if(element('event-details').open)return;
  if(event.key==='ArrowLeft'||event.key==='ArrowRight'){
    const card=story.querySelectorAll('.story-card')[activeIndex];
    const control=card?.querySelector(event.key==='ArrowLeft'?'.event-prev':'.event-next');
    if(control&&!control.disabled){event.preventDefault();control.click();}return;
  }
  if(event.target.closest('button,a'))return;
  if(event.key==='ArrowDown'||event.key==='PageDown'){event.preventDefault();scrollToChapter(Math.round(story.scrollTop/story.clientHeight)+1);}
  if(event.key==='ArrowUp'||event.key==='PageUp'){event.preventDefault();scrollToChapter(Math.round(story.scrollTop/story.clientHeight)-1);}
  if(event.key==='+'||event.key==='=')enterFocused();
  if(event.key==='-'||event.key==='Escape')goUp();
});
element('close-details').onclick=closeEventDetails;
element('return-to-map').onclick=closeEventDetails;
element('event-details').addEventListener('cancel',event=>{event.preventDefault();closeEventDetails();});
element('event-details').addEventListener('click',event=>{if(event.target===element('event-details'))closeEventDetails();});
element('event-details').addEventListener('close',()=>{
  const state=detailsState;detailsState=null;
  if(!state)return;
  story.scrollTo({top:state.top,behavior:'instant'});
  for(const {node,left} of state.carousels)if(node.isConnected)node.scrollTo({left,behavior:'instant'});
  if(state.focus?.isConnected)state.focus.focus({preventScroll:true});
  queueStory();
});
if(window.ResizeObserver)layoutObserver=new ResizeObserver(queueStory);
window.addEventListener('resize',queueStory);
document.fonts?.ready.then(queueStory);
entries=feedEntries(currentID);
renderFeed();
drawStory();
start();
