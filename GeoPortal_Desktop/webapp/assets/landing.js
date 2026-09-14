(() => {
  const root = document;
  const menuButton = root.getElementById('menuButton');
  const mobileNav = root.getElementById('mobileNav');
  const filters = [...root.querySelectorAll('.filter')];
  const cards = [...root.querySelectorAll('.solution-card')];
  const search = root.getElementById('solutionSearch');
  const empty = root.getElementById('emptyState');
  const modal = root.getElementById('detailModal');
  const modalKicker = root.getElementById('modalKicker');
  const modalTitle = root.getElementById('modalTitle');
  const modalText = root.getElementById('modalText');
  const modalFeatures = root.getElementById('modalFeatures');
  const modalActions = root.getElementById('modalActions');
  let activeFilter = 'all';
  let lastFocused = null;

  const details = {
    geoportal: { kicker:'CORE GEO-PLATFORM', title:'Research GIS GeoPortal', text:'A Tomcat-deployable browser GIS workspace designed for interoperable mapping and server-side geoprocessing.', features:['OSM, satellite & Google basemap support','WMS, WFS and WMTS connections','Shapefile, GeoPackage and GeoJSON workflows','Raster processing with GDAL','Vector processing with OGR','LAS/LAZ processing hooks with PDAL'], action:'Launch GeoPortal', href:'/geoportal/geoportal.html' },
    sathi: { kicker:'QGIS PLUGIN', title:'SATHI', text:'A QGIS research plugin concept for spatial aggregation, temporal harmonization and interpolation of raster, NetCDF and climate-oriented spatial datasets.', features:['Spatial aggregation','Daily / weekly / monthly summaries','Temporal harmonization','Raster and NetCDF workflows','AOI-based extraction','Interpolation-ready processing'] },
    spatialmean: { kicker:'SPATIAL ANALYSIS', title:'Spatial Aggregation Mean', text:'A focused GIS/remote-sensing workflow for summarizing raster or gridded observations by polygon, grid or analysis zone using reproducible spatial mean calculations.', features:['Polygon/grid aggregation','Zonal mean summaries','Raster-to-zone statistics','Area-based spatial reporting','Map-ready output tables','GIS export workflow'] },
    lidarstudio: { kicker:'LIDAR + VECTOR AUTOMATION', title:'LiDAR AutoVector Studio', text:'A LiDAR workflow studio for point-cloud preparation, terrain interpretation and assisted vector-layer generation from LiDAR-derived spatial features.', features:['LAS / LAZ input','Point-cloud preprocessing','Ground / terrain workflow','Derived-feature interpretation','Vector-layer generation','GIS-ready export'] },
    field: { kicker:'AGROMET FIELD UTILITIES', title:'Agromet Field Utilities', text:'A family of practical field tools combining meteorological calculations, elevation context and standardized export for agricultural research workflows.', features:['Psychrometric calculations','Elevation context','Field observations','CSV export','Standardized reports','Agroclimatic utilities'] }
  };

  function toggleMenu(force) {
    const open = typeof force === 'boolean' ? force : !mobileNav.classList.contains('open');
    mobileNav.classList.toggle('open', open);
    menuButton.setAttribute('aria-expanded', String(open));
  }
  menuButton.addEventListener('click', () => toggleMenu());
  mobileNav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => toggleMenu(false)));

  function applyFilter() {
    const term = search.value.trim().toLowerCase();
    let shown = 0;
    cards.forEach(card => {
      const tags = card.dataset.tags || '';
      const text = card.textContent.toLowerCase();
      const categoryMatch = activeFilter === 'all' || tags.split(/\s+/).includes(activeFilter);
      const searchMatch = !term || text.includes(term) || tags.includes(term);
      const visible = categoryMatch && searchMatch;
      card.classList.toggle('is-hidden', !visible);
      if (visible) shown++;
    });
    empty.hidden = shown !== 0;
  }
  filters.forEach(button => button.addEventListener('click', () => {
    activeFilter = button.dataset.filter;
    filters.forEach(b => b.classList.toggle('active', b === button));
    applyFilter();
  }));
  search.addEventListener('input', applyFilter);

  function openModal(key, trigger) {
    const data = details[key];
    if (!data) return;
    lastFocused = trigger;
    modalKicker.textContent = data.kicker;
    modalTitle.textContent = data.title;
    modalText.textContent = data.text;
    modalFeatures.innerHTML = '';
    data.features.forEach(feature => {
      const span = document.createElement('span'); span.textContent = feature; modalFeatures.appendChild(span);
    });
    modalActions.innerHTML = '';
    if (data.href) {
      const link = document.createElement('a'); link.className = 'button primary'; link.href = data.href; link.textContent = data.action; modalActions.appendChild(link);
    } else {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'button secondary'; button.textContent = 'Close details'; button.addEventListener('click', closeModal); modalActions.appendChild(button);
    }
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    modal.querySelector('.modal-close').focus();
  }
  function closeModal() {
    modal.hidden = true;
    document.body.style.overflow = '';
    if (lastFocused) lastFocused.focus();
  }
  root.querySelectorAll('[data-detail]').forEach(button => button.addEventListener('click', () => openModal(button.dataset.detail, button)));
  root.querySelectorAll('[data-close-modal]').forEach(el => el.addEventListener('click', closeModal));
  root.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });


  // Interactive landing-page domain imagery
  const agriRange = root.getElementById('agriRange');
  const agriOverlay = root.getElementById('agriOverlay');
  const agriPercent = root.getElementById('agriPercent');
  const agriVigor = root.getElementById('agriVigor');
  if (agriRange && agriOverlay && agriPercent && agriVigor) {
    const updateAgriculture = () => {
      const value = Math.max(0, Math.min(100, Number(agriRange.value) || 0));
      agriOverlay.style.opacity = String(0.12 + value / 130);
      agriPercent.textContent = value + '%';
      agriVigor.textContent = (0.38 + value * 0.005).toFixed(2);
    };
    agriRange.addEventListener('input', updateAgriculture);
    updateAgriculture();
  }

  const climateMetrics = {
    temperature: { label: 'Air temperature', value: '24.6', unit: '°C', bars: [78,55,88,64,72,48] },
    humidity: { label: 'Relative humidity', value: '78', unit: '%', bars: [68,74,82,76,70,79] },
    rainfall: { label: 'Daily rainfall', value: '18.4', unit: 'mm', bars: [18,42,72,34,88,57] }
  };
  const climateLabel = root.getElementById('climateMetricLabel');
  const climateValue = root.getElementById('climateMetricValue');
  const climateUnit = root.getElementById('climateMetricUnit');
  const climateButtons = [...root.querySelectorAll('[data-climate-metric]')];
  const climateBars = [...root.querySelectorAll('.mini-bars span')];
  climateButtons.forEach(button => button.addEventListener('click', () => {
    const metric = climateMetrics[button.dataset.climateMetric];
    if (!metric) return;
    climateButtons.forEach(b => b.classList.toggle('active', b === button));
    if (climateLabel) climateLabel.textContent = metric.label;
    if (climateValue) climateValue.textContent = metric.value;
    if (climateUnit) climateUnit.textContent = metric.unit;
    climateBars.forEach((bar, i) => { bar.style.setProperty('--bar', (metric.bars[i] || 30) + '%'); });
  }));

  const waterRange = root.getElementById('waterRange');
  const waterOverlay = root.getElementById('waterOverlay');
  const waterPercent = root.getElementById('waterPercent');
  const waterValue = root.getElementById('waterValue');
  if (waterRange && waterOverlay && waterPercent && waterValue) {
    const updateWater = () => {
      const value = Math.max(0, Math.min(100, Number(waterRange.value) || 0));
      waterOverlay.style.opacity = String(0.15 + value / 120);
      waterPercent.textContent = value + '%';
      waterValue.textContent = String(Math.round(12 + value * 0.38));
    };
    waterRange.addEventListener('input', updateWater);
    updateWater();
  }

  const reveals = [...root.querySelectorAll('.reveal')];
  if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => { if (entry.isIntersecting) { entry.target.classList.add('visible'); observer.unobserve(entry.target); } });
    }, { threshold: .12 });
    reveals.forEach(el => observer.observe(el));
  } else reveals.forEach(el => el.classList.add('visible'));
})();
