import { createSelector } from 'reselect';

import { isResourceViewModeSelector } from '../selectors/topology';


export const showingTimeTravelSelector = createSelector(
  [
    state => state.getIn(['capabilities', 'report_persistence'], false),
    isResourceViewModeSelector,
  ],
  (hasReportPersistence, isResourceViewMode) => hasReportPersistence && !isResourceViewMode
);

export const isPausedSelector = createSelector(
  [
    state => state.get('pausedAt')
  ],
  pausedAt => !!pausedAt
);
