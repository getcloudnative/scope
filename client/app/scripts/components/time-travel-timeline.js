import React from 'react';
import moment from 'moment';
import classNames from 'classnames';
import { debounce, map } from 'lodash';
import { connect } from 'react-redux';
import { fromJS } from 'immutable';
import { zoom } from 'd3-zoom';
import { drag } from 'd3-drag';
import { scaleUtc } from 'd3-scale';
import { event as d3Event, select } from 'd3-selection';
import {
  jumpToTime,
} from '../actions/app-actions';

import {
  TIMELINE_TICK_INTERVAL,
  TIMELINE_DEBOUNCE_INTERVAL,
} from '../constants/timer';


function timestampShortLabel(timestamp) {
  if (moment(timestamp).startOf('minute').isBefore(timestamp)) return timestamp.format(':ss');
  if (moment(timestamp).startOf('hour').isBefore(timestamp)) return timestamp.format('HH:mm');
  if (moment(timestamp).startOf('day').isBefore(timestamp)) return timestamp.format('HH:00');
  if (moment(timestamp).startOf('month').isBefore(timestamp)) return timestamp.format('MMM DD');
  if (moment(timestamp).startOf('year').isBefore(timestamp)) return timestamp.format('MMM');
  return timestamp.format('YYYY');
}

const R = 2000;
const C = 1000000;

class TimeTravelTimeline extends React.Component {
  constructor(props, context) {
    super(props, context);

    this.state = {
      timestampNow: moment(),
      focusedTimestamp: moment(),
      timelineRange: moment.duration(C, 'seconds'),
      isDragging: false,
    };

    this.width = 2000;

    this.saveSvgRef = this.saveSvgRef.bind(this);
    this.dragStarted = this.dragStarted.bind(this);
    this.dragEnded = this.dragEnded.bind(this);
    this.dragged = this.dragged.bind(this);
    this.zoomed = this.zoomed.bind(this);
    this.jumpTo = this.jumpTo.bind(this);
    this.jumpForward = this.jumpForward.bind(this);
    this.jumpBackward = this.jumpBackward.bind(this);

    this.debouncedUpdateTimestamp = debounce(
      this.updateTimestamp.bind(this), TIMELINE_DEBOUNCE_INTERVAL);
  }

  componentDidMount() {
    this.svg = select('svg#time-travel-timeline');
    this.drag = drag()
      .on('start', this.dragStarted)
      .on('end', this.dragEnded)
      .on('drag', this.dragged);
    this.zoom = zoom()
      .scaleExtent([0.002, 8000])
      .on('zoom', this.zoomed);

    this.setZoomTriggers(true);

    // Force periodic re-renders to update the slider position as time goes by.
    this.timer = setInterval(() => {
      this.setState({ timestampNow: moment().startOf('second') });
    }, TIMELINE_TICK_INTERVAL);
  }

  componentWillUnmount() {
    clearInterval(this.timer);
    this.setZoomTriggers(false);
  }

  componentWillReceiveProps(nextProps) {
    if (nextProps.pausedAt) {
      this.setState({ focusedTimestamp: nextProps.pausedAt });
    }
    this.width = this.svgRef.getBoundingClientRect().width;
  }

  updateTimestamp(timestamp) {
    this.props.jumpToTime(moment(timestamp));
  }

  setZoomTriggers(zoomingEnabled) {
    if (zoomingEnabled) {
      this.svg.call(this.drag);
      // use d3-zoom defaults but exclude double clicks
      this.svg.call(this.zoom)
        .on('dblclick.zoom', null);
    } else {
      this.svg.on('.zoom', null);
    }
  }

  zoomed() {
    const timelineRange = moment.duration(C / d3Event.transform.k, 'seconds');
    // console.log('ZOOM', timelineRange.toJSON());
    this.setState({ timelineRange });
  }

  dragStarted() {
    this.setState({ isDragging: true });
  }

  dragged() {
    const { focusedTimestamp, timelineRange } = this.state;
    const mv = timelineRange.asMilliseconds() / R;
    const newTimestamp = moment(focusedTimestamp).subtract(d3Event.dx * mv);
    // console.log('DRAG', newTimestamp.toDate());
    this.jumpTo(newTimestamp);
  }

  dragEnded() {
    this.setState({ isDragging: false });
  }

  jumpTo(timestamp) {
    const { timestampNow } = this.state;
    const focusedTimestamp = timestamp > timestampNow ? timestampNow : timestamp;
    this.props.onUpdateTimestamp(focusedTimestamp);
    this.setState({ focusedTimestamp });
  }

  jumpForward() {
    const d = this.state.timelineRange.asMilliseconds() / 4 / R;
    const timestamp = moment(this.state.focusedTimestamp).add(d * this.width);
    this.jumpTo(timestamp);
  }

  jumpBackward() {
    const d = this.state.timelineRange.asMilliseconds() / 4 / R;
    const timestamp = moment(this.state.focusedTimestamp).subtract(d * this.width);
    this.jumpTo(timestamp);
  }

  saveSvgRef(ref) {
    this.svgRef = ref;
  }

  renderAxis() {
    const { timelineRange, focusedTimestamp, timestampNow } = this.state;
    const rTimestamp = moment(focusedTimestamp).startOf('second').utc();
    const startDate = moment(rTimestamp).subtract(timelineRange);
    const endDate = moment(rTimestamp).add(timelineRange);
    const timeScale = scaleUtc()
      .domain([startDate, endDate])
      .range([-R, R]);

    const ticks = map(timeScale.ticks(30), t => moment(t).utc());

    const nowX = Math.min(timeScale(timestampNow), R);

    // ${10 * Math.log(timelineRange.as('seconds') / C)}
    return (
      <g id="axis">
        <rect
          className="available-range"
          transform={`translate(${nowX}, 0)`}
          x={-2 * R} y={-30} width={2 * R} height={60} />
        <line x1={-R} x2={R} stroke="#ddd" strokeWidth="1" />
        <g className="ticks">
          {fromJS(ticks).map(timestamp => (
            <foreignObject
              transform={`translate(${timeScale(timestamp) - 50}, 0)`}
              key={timestamp.format()}
              style={{ textAlign: 'center' }}
              width="100" height="20">
              <a
                className="timestamp-label"
                onClick={() => this.jumpTo(timestamp)}>
                {timestampShortLabel(timestamp)}
              </a>
            </foreignObject>
          ))}
        </g>
      </g>
    );
  }

  render() {
    const className = classNames({ dragging: this.state.isDragging });
    return (
      <div className="time-travel-timeline">
        <a className="button jump-backward" onClick={this.jumpBackward}>
          <span className="fa fa-chevron-left" />
        </a>
        <svg
          className={className}
          id="time-travel-timeline"
          viewBox={`${-this.width / 2} -30 ${this.width} 60`}
          width="100%" height="100%"
          ref={this.saveSvgRef}>
          <g className="view">
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
    viewportWidth: state.getIn(['viewport', 'width']),
    pausedAt: state.get('pausedAt'),
  };
}


export default connect(
  mapStateToProps,
  {
    jumpToTime,
  }
)(TimeTravelTimeline);
