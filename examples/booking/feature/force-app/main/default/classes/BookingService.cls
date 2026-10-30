public with sharing class BookingService {
    public static void confirm(Id bookingId) {
        Booking__c booking = [SELECT Id, GuestEmail__c FROM Booking__c WHERE Id = :bookingId];
        booking.GuestEmail__c = 'guest@example.com';
        HttpRequest request = new HttpRequest();
        request.setEndpoint('http://legacy-gateway.internal/book');
        request.setMethod('POST');
        update booking;
    }
}
