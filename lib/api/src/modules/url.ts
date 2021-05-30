import { navigate as navigateRouter, NavigateOptions } from '@reach/router';
import {
  NAVIGATE_URL,
  STORY_ARGS_UPDATED,
  SET_CURRENT_STORY,
  GLOBALS_UPDATED,
} from '@storybook/core-events';
import { queryFromLocation, navigate as queryNavigate, buildArgsParam } from '@storybook/router';
import { toId, sanitize } from '@storybook/csf';
import deepEqual from 'fast-deep-equal';
import global from 'global';

import { ModuleArgs, ModuleFn } from '../index';
import { PanelPositions } from './layout';
import { isStory } from '../lib/stories';

const { window: globalWindow } = global;

interface Additions {
  isFullscreen?: boolean;
  showPanel?: boolean;
  panelPosition?: PanelPositions;
  showNav?: boolean;
  selectedPanel?: string;
  viewMode?: string;
}

export interface SubState {
  customQueryParams: QueryParams;
}

// Initialize the state based on the URL.
// NOTE:
//   Although we don't change the URL when you change the state, we do support setting initial state
//   via the following URL parameters:
//     - full: 0/1 -- show fullscreen
//     - panel: bottom/right/0 -- set addons panel position (or hide)
//     - nav: 0/1 -- show or hide the story list
//
//   We also support legacy URLs from storybook <5
let prevParams: ReturnType<typeof queryFromLocation>;
const initialUrlSupport = ({
  state: { location, path, viewMode, storyId: storyIdFromUrl },
}: ModuleArgs) => {
  const addition: Additions = {};
  const query = queryFromLocation(location);
  let selectedPanel;

  const {
    full,
    panel,
    nav,
    addons,
    panelRight,
    stories,
    addonPanel,
    selectedKind,
    selectedStory,
    path: queryPath,
    ...otherParams
  } = query;

  if (full === '1') {
    addition.isFullscreen = true;
  }
  if (panel) {
    if (['right', 'bottom'].includes(panel)) {
      addition.panelPosition = panel;
    } else if (panel === '0') {
      addition.showPanel = false;
    }
  }
  if (nav === '0') {
    addition.showNav = false;
  }

  // Legacy URLs
  if (addons === '0') {
    addition.showPanel = false;
  }
  if (panelRight === '1') {
    addition.panelPosition = 'right';
  }
  if (stories === '0') {
    addition.showNav = false;
  }

  if (addonPanel) {
    selectedPanel = addonPanel;
  }

  // If the user hasn't set the storyId on the URL, we support legacy URLs (selectedKind/selectedStory)
  // NOTE: this "storyId" can just be a prefix of a storyId, really it is a storyIdSpecifier.
  let storyId = storyIdFromUrl;
  if (!storyId) {
    if (selectedKind && selectedStory) {
      storyId = toId(selectedKind, selectedStory);
    } else if (selectedKind) {
      storyId = sanitize(selectedKind);
    }
  }

  // Avoid returning a new object each time if no params actually changed.
  const customQueryParams = deepEqual(prevParams, otherParams) ? prevParams : otherParams;
  prevParams = customQueryParams;

  return { viewMode, layout: addition, selectedPanel, location, path, customQueryParams, storyId };
};

export interface QueryParams {
  [key: string]: string | null;
}

export interface SubAPI {
  navigateUrl: (url: string, options: NavigateOptions<{}>) => void;
  getQueryParam: (key: string) => string | undefined;
  getUrlState: () => {
    queryParams: QueryParams;
    path: string;
    viewMode?: string;
    storyId?: string;
    url: string;
  };
  setQueryParams: (input: QueryParams) => void;
}

export const init: ModuleFn = ({ store, navigate, state, provider, fullAPI, ...rest }) => {
  const api: SubAPI = {
    getQueryParam(key) {
      const { customQueryParams } = store.getState();
      return customQueryParams ? customQueryParams[key] : undefined;
    },
    getUrlState() {
      const { path, customQueryParams, storyId, url, viewMode } = store.getState();
      return { path, queryParams: customQueryParams, storyId, url, viewMode };
    },
    setQueryParams(input) {
      const { customQueryParams } = store.getState();
      const queryParams: QueryParams = {};
      const update = {
        ...customQueryParams,
        ...Object.entries(input).reduce((acc, [key, value]) => {
          if (value !== null) {
            acc[key] = value;
          }
          return acc;
        }, queryParams),
      };
      const equal = deepEqual(customQueryParams, update);
      if (!equal) store.setState({ customQueryParams: update });
    },
    navigateUrl(url: string, options: NavigateOptions<{}>) {
      navigateRouter(url, options);
    },
  };

  const initModule = () => {
    // Sets `args` parameter in URL, omitting any args that have their initial value or cannot be unserialized safely.
    const updateArgsParam = () => {
      const { path, viewMode } = fullAPI.getUrlState();
      if (viewMode !== 'story') return;

      const currentStory = fullAPI.getCurrentStoryData();
      if (!isStory(currentStory)) return;

      const { args, initialArgs } = currentStory;
      const argsString = buildArgsParam(initialArgs, args);
      const argsParam = argsString.length ? `&args=${argsString}` : '';
      queryNavigate(`${path}${argsParam}`, { replace: true });
      api.setQueryParams({ args: argsString });
    };

    fullAPI.on(SET_CURRENT_STORY, () => updateArgsParam());

    let handleOrId: any;
    fullAPI.on(STORY_ARGS_UPDATED, () => {
      if ('requestIdleCallback' in globalWindow) {
        if (handleOrId) globalWindow.cancelIdleCallback(handleOrId);
        handleOrId = globalWindow.requestIdleCallback(updateArgsParam, { timeout: 1000 });
      } else {
        if (handleOrId) clearTimeout(handleOrId);
        setTimeout(updateArgsParam, 100);
      }
    });

    fullAPI.on(GLOBALS_UPDATED, ({ globals, initialGlobals }) => {
      const { path } = fullAPI.getUrlState();
      const argsString = buildArgsParam(initialGlobals, globals);
      const globalsParam = argsString.length ? `&globals=${argsString}` : '';
      queryNavigate(`${path}${globalsParam}`, { replace: true });
      api.setQueryParams({ globals: argsString });
    });

    fullAPI.on(NAVIGATE_URL, (url: string, options: { [k: string]: any }) => {
      fullAPI.navigateUrl(url, options);
    });

    if (fullAPI.showReleaseNotesOnLaunch()) {
      navigate('/settings/release-notes');
    }
  };

  return {
    api,
    state: initialUrlSupport({ store, navigate, state, provider, fullAPI, ...rest }),
    init: initModule,
  };
};
