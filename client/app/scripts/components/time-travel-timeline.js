import React from 'react';
import moment from 'moment';
import classNames from 'classnames';
import { debounce } from 'lodash';
import { connect } from 'react-redux';
import { fromJS } from 'immutable';
import { zoom } from 'd3-zoom';
import { drag } from 'd3-drag';
import { scaleUtc } from 'd3-scale';
import { timeFormat } from 'd3-time-format';
import { timeMinute, timeHour, timeDay, timeMonth, timeYear } from 'd3-time';
import { event as d3Event, select } from 'd3-selection';
import {
  jumpToTime,
} from '../actions/app-actions';

import {
  TIMELINE_DEBOUNCE_INTERVAL,
} from '../constants/timer';

const formatSecond = timeFormat(':%S');
const formatMinute = timeFormat('%H:%M');
const formatHour = timeFormat('%H:00');
const formatDay = timeFormat('%b %d');
const formatMonth = timeFormat('%b');
const formatYear = timeFormat('%Y');

function multiFormat(date) {
  date = new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(),
    date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds());
  if (timeMinute(date) < date) return formatSecond(date);
  if (timeHour(date) < date) return formatMinute(date);
  if (timeDay(date) < date) return formatHour(date);
  if (timeMonth(date) < date) return formatDay(date);
  if (timeYear(date) < date) return formatMonth(date);
  return formatYear(date);
}

const R = 10000;
const C = 1000000;

class TimeTravelTimeline extends React.Component {
  constructor(props, context) {
    super(props, context);

    this.state = {
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
    this.zoom = zoom().on('zoom', this.zoomed);
    this.setZoomTriggers(true);
  }

  componentWillUnmount() {
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
    const mv = timelineRange.as('seconds') / R;
    const newTimestamp = moment(focusedTimestamp).subtract(d3Event.dx * mv, 'seconds');
    // console.log('DRAG', newTimestamp.toDate());
    this.jumpTo(newTimestamp);
  }

  dragEnded() {
    this.setState({ isDragging: false });
  }

  jumpTo(timestamp) {
    this.setState({ focusedTimestamp: timestamp });
    this.props.onUpdateTimestamp(timestamp);
  }

  jumpForward() {
    const d = this.state.timelineRange.asMilliseconds() / 3;
    const timestamp = moment(this.state.focusedTimestamp).add(d);
    this.jumpTo(timestamp);
  }

  jumpBackward() {
    const d = this.state.timelineRange.asMilliseconds() / 3;
    const timestamp = moment(this.state.focusedTimestamp).subtract(d);
    this.jumpTo(timestamp);
  }

  saveSvgRef(ref) {
    this.svgRef = ref;
  }

  renderAxis() {
    const { timelineRange, focusedTimestamp } = this.state;
    const startDate = moment(focusedTimestamp).subtract(timelineRange);
    const endDate = moment(focusedTimestamp).add(timelineRange);
    const timeScale = scaleUtc()
      .domain([startDate, endDate])
      .range([-R, R]);
    const ticks = timeScale.ticks(150);

    // ${10 * Math.log(timelineRange.as('seconds') / C)}
    return (
      <g id="axis">
        <g className="ticks">
          {fromJS(ticks).map(date => (
            <foreignObject
              transform={`translate(${timeScale(date) - 25}, 0)`}
              key={moment(date).format()}
              style={{ textAlign: 'center' }}
              width="50" height="20">
              <a
                className="timestamp-label"
                onClick={() => this.jumpTo(moment(date))}>
                {multiFormat(date)}
              </a>
            </foreignObject>
          ))}
        </g>
        <line x1={-R} x2={R} stroke="#ddd" strokeWidth="1" />
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
