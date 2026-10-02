(() => {
'use strict';
window.SystemCore.init().catch(error=>window.SystemCore.toast(window.SystemCore.errText(error),true));
})();
