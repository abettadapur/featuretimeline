import './WorkItemRenderer.scss';
import * as React from 'react';
import { InfoIcon } from '../InfoIcon/InfoIcon';
import { IIterationDuration, IWorkItemOverrideIteration } from '../../../redux/store';
import { IDimension, CropWorkItem } from '../../../redux/types';
import { getRowColumnStyle } from '../gridhelper';
import {
    TooltipHost, TooltipOverflowMode
} from 'office-ui-fabric-react/lib/Tooltip';
import { css } from '@uifabric/utilities/lib/css';
export interface IWorkItemRendererProps {
    id: number;
    title: string;
    color: string;
    isRoot: boolean;
    shouldShowDetails: boolean;
    allowOverride: boolean;
    iterationDuration: IIterationDuration;
    dimension: IDimension;
    crop: CropWorkItem;
    onClick: (id: number) => void;
    showDetails: (id: number) => void;
    overrideIterationStart: (payload: IWorkItemOverrideIteration) => void;
    overrideIterationEnd: () => void;

    isDragging?: boolean;
    connectDragSource?: (element: JSX.Element) => JSX.Element;
}

export interface IWorkItemRendrerState {
    left: number;
    width: number;
    top: number;
    height: number;
    resizing: boolean;
    isLeft: boolean;
}

export class WorkItemRenderer extends React.Component<IWorkItemRendererProps, IWorkItemRendrerState> {
    private _div: HTMLDivElement;
    private _origPageX: number;
    private _origWidth: number;

    public constructor(props: IWorkItemRendererProps) {
        super(props);
        this.state = {
            resizing: false
        } as IWorkItemRendrerState;
    }

    public render() {
        const {
            id,
            title,
            onClick,
            showDetails,
            isRoot,
            shouldShowDetails,
            allowOverride,
            isDragging,
            crop,
            iterationDuration
        } = this.props;

        const {
            resizing,
            left,
            top,
            height,
            width
        } = this.state

        let style = {};

        if (!resizing) {
            style = getRowColumnStyle(this.props.dimension);
        } else {
            style['position'] = 'fixed';
            style['left'] = left + "px";
            style['width'] = width + "px";
            style['top'] = top + "px";
            style['height'] = height + "px";
        }

        if (isDragging) {
            style['background'] = hexToRgb(this.props.color, 0.1);
        } else {
            style['background'] = hexToRgb(this.props.color, 0.8);
        }

        const className = isRoot ? "root-work-item" : "work-item";
        let cropClassName = "crop-none";
        let canOverrideLeft = allowOverride;
        let canOverrideRight = allowOverride;
        let leftCropped = false;
        let rightCropped = false;
        switch (crop) {
            case CropWorkItem.Left: {
                cropClassName = "crop-left";
                canOverrideLeft = false;
                leftCropped = true;
                break;
            }
            case CropWorkItem.Right: {
                cropClassName = "crop-right";
                canOverrideRight = false;
                rightCropped = true;
                break;
            }
            case CropWorkItem.Both: {
                cropClassName = "crop-both";
                canOverrideLeft = false;
                canOverrideRight = false;
                leftCropped = true;
                rightCropped = true;
                break;
            }
        }

        const infoIcon = shouldShowDetails ? <InfoIcon id={id} onClick={id => showDetails(id)} /> : null;
        const additionalTitleClass = infoIcon ? "title-with-infoicon" : "title-without-infoicon";

        let leftHandle = null;
        let rightHandle = null;

        if (!isRoot && allowOverride) {
            leftHandle = canOverrideLeft && (
                <div
                    className="small-border"
                    onMouseDown={this._leftMouseDown}
                    onMouseUp={this._mouseUp}
                />
            );

            rightHandle = canOverrideRight && (
                <div
                    className="small-border"
                    onMouseDown={this._rightMouseDown}
                    onMouseUp={this._mouseUp}
                />
            );
        }

        let startsFrom = <div />;
        if (leftCropped) {
            startsFrom = (<TooltipHost
                content={`Starts at ${iterationDuration.startIteration.name}`}>
                <div className="work-item-start-iteration-indicator">{`${iterationDuration.startIteration.name}`}</div>
            </TooltipHost>
            );
        }

        let endsAt = <div />;
        if (rightCropped) {
            endsAt = (<TooltipHost
                content={`Ends at ${iterationDuration.endIteration.name}`}>
                <div className="work-item-end-iteration-indicator">{`${iterationDuration.endIteration.name}`}</div>
            </TooltipHost>
            );
        }

        const item = (
            <div style={style}
                className={css(className, cropClassName)}
                ref={(e) => this._div = e}
            >
                {leftHandle}
                <div
                    className={css("work-item-details-container", additionalTitleClass)}
                >
                    {startsFrom}
                    <div
                        className="title-contents"
                        onClick={() => onClick(id)}
                    >
                        <TooltipHost
                            content={title}
                            overflowMode={TooltipOverflowMode.Parent}
                        >
                            {title}
                        </TooltipHost>
                    </div>
                    {endsAt}
                </div>
                {infoIcon}
                {rightHandle}
            </div>
        );

        if (isRoot) {
            return item;
        }
        const { connectDragSource } = this.props;

        return connectDragSource(item);
    }

    private _leftMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
        this._resizeStart(e, true);
    }

    private _rightMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
        this._resizeStart(e, false);
    }

    private _mouseUp = () => {
        window.removeEventListener("mousemove", this._mouseMove);
        window.removeEventListener("mouseup", this._mouseUp);
        this.setState({
            resizing: false
        });

        this.props.overrideIterationEnd();
    }

    private _resizeStart(e: React.MouseEvent<HTMLDivElement>, isLeft: boolean) {
        e.preventDefault();
        const rect = this._div.getBoundingClientRect() as ClientRect;
        this._origPageX = e.pageX;
        this._origWidth = rect.width;

        this.props.overrideIterationStart({
            workItemId: this.props.id,
            iterationDuration: {
                startIterationId: this.props.iterationDuration.startIteration.id,
                endIterationId: this.props.iterationDuration.endIteration.id,
                user: VSS.getWebContext().user.uniqueName
            },
            changingStart: isLeft
        });

        window.addEventListener("mousemove", this._mouseMove);
        window.addEventListener("mouseup", this._mouseUp);

        this.setState({
            left: rect.left,
            width: rect.width,
            top: rect.top - 10, //The rect.top does not contain margin-top
            height: rect.height,
            resizing: true,
            isLeft: isLeft
        });
    }

    private _mouseMove = (ev: MouseEvent) => {
        ev.preventDefault();
        const newPageX = ev.pageX;
        if (this.state.isLeft) {
            let width = 0;
            // moved mouse left we need to increase the width
            if (newPageX < this._origPageX) {
                width = this._origWidth + (this._origPageX - newPageX);
            } else {
                // moved mouse right we need to decrease the width
                width = this._origWidth - (newPageX - this._origPageX);
            }

            if (width > 100) {
                this.setState({
                    left: ev.clientX,
                    width: width
                });
            }
        } else {
            let width = 0;
            // movd left we need to decrease the width
            if (newPageX < this._origPageX) {
                width = this._origWidth - (this._origPageX - newPageX);
            } else {
                // We need to increase the width
                width = this._origWidth + (newPageX - this._origPageX);
            }

            if (width > 100) {
                this.setState({
                    width: width
                });
            }
        }
    }
}


function hexToRgb(hex: string, opacity: number) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    const rgb = result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;

    if (rgb) {
        const {
            r,
            g,
            b
        } = rgb;
        return `rgba(${r},${g},${b}, ${opacity})`;
    }
}
