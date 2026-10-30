public with sharing class BookingService {
    public static void confirm(Id bookingId) {
        Booking__c booking = [SELECT Id FROM Booking__c WHERE Id = :bookingId];
        update booking;
    }
}
