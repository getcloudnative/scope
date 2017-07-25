import React from 'react';
import moment from 'moment';
import classNames from 'classnames';
import { map, clamp, find, last } from 'lodash';
import { connect } from 'react-redux';
import { drag } from 'd3-drag';
import { scaleUtc } from 'd3-scale';
import { event as d3Event, select } from 'd3-selection';

import {
  nowInSecondsPrecision,
  clampToNowInSecondsPrecision,
  scaleDuration,
} from '../utils/time-utils';

import { TIMELINE_TICK_INTERVAL } from '../constants/timer';


const TICK_SETTINGS_PER_PERIOD = {
  year: {
    format: 'YYYY',
    childPeriod: 'month',
    intervals: [
      moment.duration(1, 'year'),
    ],
  },
  month: {
    format: 'MMMM',
    parentPeriod: 'year',
    childPeriod: 'day',
    intervals: [
      moment.duration(1, 'month'),
      moment.duration(3, 'months'),
    ],
  },
  day: {
    format: 'Do',
    parentPeriod: 'month',
    childPeriod: 'minute',
    intervals: [
      moment.duration(1, 'day'),
      moment.duration(1, 'week'),
    ],
  },
  minute: {
    format: 'HH:mm',
    parentPeriod: 'day',
    intervals: [
      moment.duration(1, 'minute'),
      moment.duration(5, 'minutes'),
      moment.duration(15, 'minutes'),
      moment.duration(1, 'hour'),
      moment.duration(3, 'hours'),
      moment.duration(6, 'hours'),
    ],
  },
};

const MIN_DURATION_PER_PX = moment.duration(250, 'milliseconds');
const INIT_DURATION_PER_PX = moment.duration(1, 'minute');
const MAX_DURATION_PER_PX = moment.duration(3, 'days');
const MIN_TICK_SPACING_PX = 80;
const MAX_TICK_SPACING_PX = 415;
const ZOOM_SENSITIVITY = 1.0015;
const FADE_OUT_FACTOR = 1.4;


class TimeTravelTimeline extends React.Component {
  constructor(props, context) {
    super(props, context);

    this.state = {
      timestampNow: nowInSecondsPrecision(),
      focusedTimestamp: nowInSecondsPrecision(),
      durationPerPixel: INIT_DURATION_PER_PX,
      boundingRect: { width: 0, height: 0 },
      isPanning: false,
    };

    this.jumpRelativePixels = this.jumpRelativePixels.bind(this);
    this.jumpForward = this.jumpForward.bind(this);
    this.jumpBackward = this.jumpBackward.bind(this);
    this.jumpTo = this.jumpTo.bind(this);

    this.handleZoom = this.handleZoom.bind(this);
    this.handlePanStart = this.handlePanStart.bind(this);
    this.handlePanEnd = this.handlePanEnd.bind(this);
    this.handlePan = this.handlePan.bind(this);

    this.saveSvgRef = this.saveSvgRef.bind(this);
  }

  componentDidMount() {
    this.svg = select('.time-travel-timeline svg');
    this.drag = drag()
      .on('start', this.handlePanStart)
      .on('end', this.handlePanEnd)
      .on('drag', this.handlePan);
    this.svg.call(this.drag);

    // Force periodic updates of the availability range as time goes by.
    this.timer = setInterval(() => {
      this.setState({ timestampNow: nowInSecondsPrecision() });
    }, TIMELINE_TICK_INTERVAL);
  }

  componentWillUnmount() {
    clearInterval(this.timer);
  }

  componentWillReceiveProps(nextProps) {
    // Don't update the focused timestamp if we're not paused (so the timeline is hidden).
    if (nextProps.pausedAt) {
      this.setState({ focusedTimestamp: nextProps.pausedAt });
    }
    // Always update the timeline dimension information.
    this.setState({ boundingRect: this.svgRef.getBoundingClientRect() });
  }

  saveSvgRef(ref) {
    this.svgRef = ref;
  }

  handlePanStart() {
    this.setState({ isPanning: true });
  }

  handlePanEnd() {
    this.props.onTimelinePanEnd(this.state.focusedTimestamp);
    this.setState({ isPanning: false });
  }

  handlePan() {
    const dragDuration = scaleDuration(this.state.durationPerPixel, -d3Event.dx);
    const timestamp = moment(this.state.focusedTimestamp).add(dragDuration);
    const focusedTimestamp = clampToNowInSecondsPrecision(timestamp);
    this.props.onTimelinePan(focusedTimestamp);
    this.setState({ focusedTimestamp });
  }

  handleZoom(e) {
    const scale = Math.pow(ZOOM_SENSITIVITY, e.deltaY);
    let durationPerPixel = scaleDuration(this.state.durationPerPixel, scale);
    if (durationPerPixel > MAX_DURATION_PER_PX) durationPerPixel = MAX_DURATION_PER_PX;
    if (durationPerPixel < MIN_DURATION_PER_PX) durationPerPixel = MIN_DURATION_PER_PX;
    this.setState({ durationPerPixel });
  }

  jumpTo(timestamp) {
    const focusedTimestamp = clampToNowInSecondsPrecision(timestamp);
    this.props.onInstantJump(focusedTimestamp);
    this.setState({ focusedTimestamp });
  }

  jumpRelativePixels(pixels) {
    const duration = scaleDuration(this.state.durationPerPixel, pixels);
    const timestamp = moment(this.state.focusedTimestamp).add(duration);
    this.jumpTo(timestamp);
  }

  jumpForward() {
    this.jumpRelativePixels(this.state.boundingRect.width / 4);
  }

  jumpBackward() {
    this.jumpRelativePixels(-this.state.boundingRect.width / 4);
  }

  findOptimalDuration(durations) {
    const { durationPerPixel } = this.state;
    const minimalDuration = scaleDuration(durationPerPixel, 1.1 * MIN_TICK_SPACING_PX);
    return find(durations, d => d >= minimalDuration);
  }

  getTimeScale() {
    const { durationPerPixel, focusedTimestamp } = this.state;
    const roundedTimestamp = moment(focusedTimestamp).utc().startOf('second');
    const startDate = moment(roundedTimestamp).subtract(durationPerPixel);
    const endDate = moment(roundedTimestamp).add(durationPerPixel);
    return scaleUtc()
      .domain([startDate, endDate])
      .range([-1, 1]);
  }

  getVerticalShiftForPeriod(period) {
    const { childPeriod, parentPeriod } = TICK_SETTINGS_PER_PERIOD[period];
    const currentDuration = this.state.durationPerPixel;

    let shift = 1;
    if (parentPeriod) {
      const durationMultiplier = 1 / MAX_TICK_SPACING_PX;
      const parentPeriodStartInterval = TICK_SETTINGS_PER_PERIOD[parentPeriod].intervals[0];
      const fadedInDuration = scaleDuration(parentPeriodStartInterval, durationMultiplier);
      const fadedOutDuration = scaleDuration(fadedInDuration, FADE_OUT_FACTOR);

      const durationLog = d => Math.log(d.asMilliseconds());
      const transitionFactor = durationLog(fadedOutDuration) - durationLog(currentDuration);
      const transitionLength = durationLog(fadedOutDuration) - durationLog(fadedInDuration);

      shift = clamp(transitionFactor / transitionLength, 0, 1);
    }

    if (childPeriod) {
      shift += this.getVerticalShiftForPeriod(childPeriod, currentDuration);
    }

    return shift;
  }

  getTicksForPeriod(period) {
    // First find the optimal duration between the ticks - if no satisfactory
    // duration could be found, don't render any ticks for the given period.
    const { parentPeriod, intervals } = TICK_SETTINGS_PER_PERIOD[period];
    const duration = this.findOptimalDuration(intervals);
    if (!duration) return [];

    // Get the boundary values for the displayed part of the timeline.
    const timeScale = this.getTimeScale();
    const startPosition = -this.state.boundingRect.width / 2;
    const endPosition = this.state.boundingRect.width / 2;
    const startDate = moment(timeScale.invert(startPosition));
    const endDate = moment(timeScale.invert(endPosition));

    // Start counting the timestamps from the most recent timestamp that is not shown
    // on screen. The values are always rounded up to the timestamps of the next bigger
    // period (e.g. for days it would be months, for months it would be years).
    let timestamp = moment(startDate).utc().startOf(parentPeriod || period);
    while (timestamp.isBefore(startDate)) {
      timestamp = moment(timestamp).add(duration);
    }
    timestamp = moment(timestamp).subtract(duration);

    // Make that hidden timestamp the first one in the list, but position
    // it inside the visible range with a prepended arrow to the past.
    const ticks = [{
      timestamp: moment(timestamp),
      position: startPosition,
      isBehind: true,
    }];

    // Continue adding ticks till the end of the visible range.
    do {
      // If the new timestamp enters into a new bigger period, we round it down to the
      // beginning of that period. E.g. instead of going [Jan 22nd, Jan 29th, Feb 5th],
      // we output [Jan 22nd, Jan 29th, Feb 1st]. Right now this case only happens between
      // days and months, but in theory it could happen whenever bigger periods are not
      // divisible by the duration we are using as a step between the ticks.
      let newTimestamp = moment(timestamp).add(duration);
      if (parentPeriod && newTimestamp.get(parentPeriod) !== timestamp.get(parentPeriod)) {
        newTimestamp = moment(newTimestamp).utc().startOf(parentPeriod);
      }
      timestamp = newTimestamp;

      // If the new tick is too close to the previous one, drop that previous tick.
      const position = timeScale(timestamp);
      const previousPosition = last(ticks) && last(ticks).position;
      if (position - previousPosition < MIN_TICK_SPACING_PX) {
        ticks.pop();
      }

      ticks.push({ timestamp, position });
    } while (timestamp.isBefore(endDate));

    return ticks;
  }

  renderTimestampTick({ timestamp, position, isBehind }, periodFormat, opacity) {
    // Ticks are disabled if they are in the future or if they are too transparent.
    const disabled = timestamp.isAfter(this.state.timestampNow) || opacity < 0.2;
    const handleClick = () => this.jumpTo(timestamp);

    return (
      <g transform={`translate(${position}, 0)`} key={timestamp.format()}>
        {!isBehind && <line y2="75" stroke="#ddd" strokeWidth="1" />}
        <title>Jump to {timestamp.utc().format()}</title>
        <foreignObject width="100" height="20">
          <a className="timestamp-label" disabled={disabled} onClick={!disabled && handleClick}>
            {isBehind && '←'}{timestamp.utc().format(periodFormat)}
          </a>
        </foreignObject>
      </g>
    );
  }

  renderPeriodTicks(period) {
    const periodFormat = TICK_SETTINGS_PER_PERIOD[period].format;
    const ticks = this.getTicksForPeriod(period);

    const verticalShift = this.getVerticalShiftForPeriod(period);
    const transform = `translate(0, ${60 - (verticalShift * 15)})`;
    const opacity = clamp(verticalShift, 0, 1);

    return (
      <g className={period} transform={transform} style={{ opacity }}>
        {map(ticks, tick => this.renderTimestampTick(tick, periodFormat, opacity))}
      </g>
    );
  }

  renderDisabledShadow() {
    const timeScale = this.getTimeScale();
    const nowShift = timeScale(this.state.timestampNow);
    const { width, height } = this.state.boundingRect;

    return (
      <rect
        className="available-range"
        transform={`translate(${nowShift}, 0)`}
        width={width} height={height}
      />
    );
  }

  renderAxis() {
    const { width, height } = this.state.boundingRect;
    return (
      <g id="axis">
        <rect
          className="tooltip-container"
          transform={`translate(${-width / 2}, 0)`}
          width={width} height={height} fillOpacity={0}
        />
        {this.renderDisabledShadow()}
        <g className="ticks">
          {this.renderPeriodTicks('year')}
          {this.renderPeriodTicks('month')}
          {this.renderPeriodTicks('day')}
          {this.renderPeriodTicks('minute')}
        </g>
      </g>
    );
  }

  render() {
    const className = classNames({ panning: this.state.isPanning });
    const halfWidth = this.state.boundingRect.width / 2;

    return (
      <div className="time-travel-timeline">
        <a className="button jump-backward" onClick={this.jumpBackward}>
          <span className="fa fa-chevron-left" />
        </a>
        <svg className={className} ref={this.saveSvgRef} onWheel={this.handleZoom}>
          <g className="view" transform={`translate(${halfWidth}, 0)`}>
            <title>Scroll to zoom, drag to pan</title>
            {this.renderAxis()}
          </g>
        </svg>
        <a className="button jump-forward" onClick={this.jumpForward}>
          <span className="fa fa-chevron-right" />
        </a>
      </div>
    );
  }
}


function mapStateToProps(state) {
  return {
    // Used only to trigger recalculations on window resize.
    viewportWidth: state.getIn(['viewport', 'width']),
    pausedAt: state.get('pausedAt'),
  };
}

export default connect(mapStateToProps)(TimeTravelTimeline);
