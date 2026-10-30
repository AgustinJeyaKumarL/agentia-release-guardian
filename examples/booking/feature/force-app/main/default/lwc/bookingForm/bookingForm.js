import GUEST_EMAIL from '@salesforce/schema/Booking__c.GuestEmail__c';
import confirm from '@salesforce/apex/BookingService.confirm';

export default class BookingForm {
  email = GUEST_EMAIL;
  save() {
    return confirm();
  }
}
