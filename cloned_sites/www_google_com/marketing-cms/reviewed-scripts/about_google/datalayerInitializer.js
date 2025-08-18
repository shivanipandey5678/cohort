/**
 * Initializes the dataLayer for analytics.
 * Checks if the current page is part of the "InFact" and pushes an event with page details.
 *
 */

(function() {
  var INFACT_PATH = '/around-the-globe/local-info/';
  var isInFactSite = window.location.pathname.includes(INFACT_PATH);
  var dataLayerValue = {
    event: 'dataLayer_initialized',
    event_params: {
      pageName: document.title,
      pageLocale: document.documentElement.lang,
      inFactPageLocale: isInFactSite ? document.documentElement.getAttribute('locale') : null
    }
  };

  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(dataLayerValue);
})();