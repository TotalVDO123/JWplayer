import ControlBar from 'view/controls/controlbar';
import SimpleModel from 'model/simplemodel';
import _ from 'test/underscore';
import sinon from 'sinon';

const model = _.extend({}, SimpleModel);
model.change = sinon.stub();
model.change.returnsThis();
model.on = sinon.stub();
model.on.returnsThis();
model.set('localization', {});

describe('Control Bar', function() {

    let controlBar;
    let container;
    let spacer;
    let children;

    beforeEach(() => {
        spacer = document.createElement('div');
        spacer.className += 'jw-spacer';

        container = document.createElement('div');
        container.appendChild(document.createElement('div'));
        container.appendChild(spacer);

        controlBar = new ControlBar({}, model);
        controlBar.elements.buttonContainer = container;
        children = container.children;
    });

    describe('updateButtons', function() {

        it('should add nothing to the container if there are no buttons', function() {
            controlBar.updateButtons({});

            expect(children.length).to.equal(2);
        });

        it('should removeButtons before adding any', function() {
            controlBar.removeButtons = sinon.stub();
            container.insertBefore = sinon.spy();

            controlBar.updateButtons(model, [{ id: '1' }]);

            expect(controlBar.removeButtons.calledBefore(container.insertBefore)).to.be.true;
        });

        it('should add button to the container', function() {
            controlBar.updateButtons(model, [{ id: '1' }]);

            expect(children.length).to.equal(3);
        });

        it('should add buttons to the container in order', function() {
            controlBar.updateButtons(model, [{ id: '1' }, { id: '2' }]);

            expect(children.length).to.equal(4);
            expect(children[2].getAttribute('button')).to.equal('1');
            expect(children[3].getAttribute('button')).to.equal('2');
        });
    });

    describe('removeButtons', function() {

        it('should do nothing if there are no buttons in the container', function() {
            controlBar.removeButtons(container);

            expect(children.length).to.equal(2);
        });

        it('should do nothing if there are buttons that do have the same ids', function() {
            container.appendChild(document.createElement('div'));
            container.appendChild(document.createElement('div'));
            container.appendChild(document.createElement('div'));

            children[2].setAttribute('button', '1');
            children[3].setAttribute('button', '2');
            children[4].setAttribute('button', '3');

            controlBar.removeButtons(container, [{ id: '4' }]);

            expect(children.length).to.equal(5);
        });

        it('should remove buttons if there are button that dont have the same ids', function() {
            container.appendChild(document.createElement('div'));
            container.appendChild(document.createElement('div'));
            container.appendChild(document.createElement('div'));

            children[2].setAttribute('button', '1');
            children[3].setAttribute('button', '2');
            children[4].setAttribute('button', '3');

            controlBar.removeButtons(container, [{ id: '1' }, { id: '2' }]);

            expect(children.length).to.equal(3);
            expect(children[2].getAttribute('button')).to.equal('3');
        });
    });
});
